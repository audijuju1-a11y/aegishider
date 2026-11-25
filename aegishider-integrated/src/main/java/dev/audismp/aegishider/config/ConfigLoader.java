package dev.audismp.aegishider.config;

import dev.audismp.aegishider.config.AegishiderConfig.DebugSettings;
import dev.audismp.aegishider.config.AegishiderConfig.MiningSettings;
import dev.audismp.aegishider.config.AegishiderConfig.PacketGatewaySettings;
import dev.audismp.aegishider.config.AegishiderConfig.RaidSettings;
import dev.audismp.aegishider.config.WorldSettings.BlockProtection;
import dev.audismp.aegishider.config.WorldSettings.EntityHeightShield;
import dev.audismp.aegishider.config.WorldSettings.ItemProtection;
import dev.audismp.aegishider.util.MaterialSets;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.entity.EntityType;

import java.util.ArrayList;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Parses YAML into the immutable {@link AegishiderConfig}. Never throws on bad user
 * input: invalid values are clamped/defaulted with a warning and the secure default
 * is used. A config error must never disable protection silently.
 */
public final class ConfigLoader {

    private ConfigLoader() {
    }

    /**
     * Built-in entity defaults, used when no world section/item list is configured.
     * They intentionally include hostile mobs: an empty config must not silently
     * downgrade entity protection to dropped items only. Every other living type
     * (animals, villagers, golems...) is covered by {@code hide-all-living-entities},
     * which defaults to true; servers that want animals visible can opt out.
     */
    private static final Set<EntityType> BUILTIN_ITEM_TYPES = Set.of(
            EntityType.ITEM,
            EntityType.ITEM_FRAME,
            EntityType.GLOW_ITEM_FRAME,
            EntityType.ARMOR_STAND,
            EntityType.CHEST_MINECART,
            EntityType.HOPPER_MINECART,
            EntityType.FURNACE_MINECART,
            EntityType.TNT_MINECART,
            EntityType.ZOMBIE,
            EntityType.ZOMBIE_VILLAGER,
            EntityType.HUSK,
            EntityType.DROWNED,
            EntityType.SKELETON,
            EntityType.STRAY,
            EntityType.BOGGED,
            EntityType.WITHER_SKELETON,
            EntityType.CREEPER,
            EntityType.SPIDER,
            EntityType.CAVE_SPIDER,
            EntityType.ENDERMAN,
            EntityType.ENDERMITE,
            EntityType.SILVERFISH,
            EntityType.WITCH,
            EntityType.PILLAGER,
            EntityType.VINDICATOR,
            EntityType.EVOKER,
            EntityType.ILLUSIONER,
            EntityType.RAVAGER,
            EntityType.VEX,
            EntityType.ZOMBIFIED_PIGLIN,
            EntityType.PIGLIN,
            EntityType.PIGLIN_BRUTE,
            EntityType.HOGLIN,
            EntityType.ZOGLIN,
            EntityType.BLAZE,
            EntityType.GHAST,
            EntityType.MAGMA_CUBE,
            EntityType.SLIME,
            EntityType.PHANTOM,
            EntityType.SHULKER,
            EntityType.GUARDIAN,
            EntityType.ELDER_GUARDIAN,
            EntityType.WARDEN,
            EntityType.WITHER,
            EntityType.ENDER_DRAGON,
            EntityType.IRON_GOLEM,
            EntityType.BREEZE
    );

    static final String[] BUILTIN_HIDDEN_BLOCKS = {
            "CHEST", "TRAPPED_CHEST", "BARREL", "ENDER_CHEST",
            "ENCHANTING_TABLE", "BEACON",
            "SHULKER_BOX", "WHITE_SHULKER_BOX", "ORANGE_SHULKER_BOX", "MAGENTA_SHULKER_BOX",
            "LIGHT_BLUE_SHULKER_BOX", "YELLOW_SHULKER_BOX", "LIME_SHULKER_BOX", "PINK_SHULKER_BOX",
            "GRAY_SHULKER_BOX", "LIGHT_GRAY_SHULKER_BOX", "CYAN_SHULKER_BOX", "PURPLE_SHULKER_BOX",
            "BLUE_SHULKER_BOX", "BROWN_SHULKER_BOX", "GREEN_SHULKER_BOX", "RED_SHULKER_BOX",
            "BLACK_SHULKER_BOX", "HOPPER", "DROPPER", "DISPENSER", "FURNACE", "BLAST_FURNACE",
            "SMOKER", "BREWING_STAND", "SPAWNER", "TRIAL_SPAWNER", "VAULT",
            "CRAFTER", "DECORATED_POT", "CHISELED_BOOKSHELF", "BOOKSHELF", "LECTERN",
            "CRAFTING_TABLE", "CARTOGRAPHY_TABLE", "FLETCHING_TABLE", "SMITHING_TABLE",
            "LOOM", "STONECUTTER", "GRINDSTONE",
            "ANVIL", "CHIPPED_ANVIL", "DAMAGED_ANVIL",
            "OBSERVER", "TARGET", "COMPOSTER", "DAYLIGHT_DETECTOR",
            "CAULDRON", "WATER_CAULDRON", "LAVA_CAULDRON", "POWDER_SNOW_CAULDRON",
            "PISTON", "STICKY_PISTON", "MOVING_PISTON", "PISTON_HEAD",
            "RESPAWN_ANCHOR", "BELL", "LODESTONE", "CONDUIT"
    };

    public static AegishiderConfig load(FileConfiguration cfg, long revision) {
        return load(cfg, revision, Map.of());
    }

    /**
     * @param environments loaded world name -> dimension. Used only to choose fair
     *                     per-dimension Y-shield defaults: Nether/End terrain sits below
     *                     the overworld cut line, so a full-volume mask there is wrong.
     */
    public static AegishiderConfig load(FileConfiguration cfg, long revision,
                                        Map<String, World.Environment> environments) {
        List<String> warnings = new ArrayList<>();

        boolean failClosed = cfg.getBoolean("security.fail-closed", true);
        if (!failClosed) {
            warnings.add("security.fail-closed=false is not supported: Aegishider always fails closed");
        }

        double budgetMs = cfg.getDouble("security.main-thread-budget-ms", 1.5);
        if (budgetMs < 0.25 || budgetMs > 20.0) {
            warnings.add("security.main-thread-budget-ms=" + budgetMs + " out of range [0.25, 20]; clamped");
            budgetMs = Math.max(0.25, Math.min(20.0, budgetMs));
        }
        int raycastBudget = cfg.getInt("security.raycast-budget-per-tick", 180);
        if (raycastBudget < 0 || raycastBudget > 5000) {
            warnings.add("security.raycast-budget-per-tick out of range [0, 5000]; clamped");
            raycastBudget = Math.max(0, Math.min(5000, raycastBudget));
        }
        String minPeVersion = cfg.getString("security.packet-gateway.minimum-version", "2.14.0");

        Set<Material> transparent = MaterialSets.resolvePatterns(
                cfg.getStringList("occlusion.transparent-blocks"), warnings, "occlusion.transparent-blocks",
                MaterialSets.defaultTransparentBlocks());
        int maxRaycastSegments = cfg.getInt("occlusion.max-raycast-segments", 8);
        if (maxRaycastSegments < 1 || maxRaycastSegments > 32) {
            warnings.add("occlusion.max-raycast-segments out of range [1, 32]; clamped");
            maxRaycastSegments = Math.max(1, Math.min(32, maxRaycastSegments));
        }

        WorldSettings builtinDefault = parseWorld("default",
                cfg.getConfigurationSection("worlds.default"), warnings, true, null);

        Map<String, WorldSettings> worlds = new LinkedHashMap<>();
        ConfigurationSection worldsSection = cfg.getConfigurationSection("worlds");
        if (worldsSection != null) {
            for (String worldName : worldsSection.getKeys(false)) {
                if (worldName.equals("default")) {
                    continue;
                }
                ConfigurationSection section = worldsSection.getConfigurationSection(worldName);
                if (section == null) {
                    warnings.add("World '" + worldName + "': configuration is not a section; ignored");
                    continue;
                }
                World.Environment environment = environments == null
                        ? null : environments.get(worldName);
                worlds.put(worldName, parseWorld(worldName, section, warnings, false, environment));
            }
        }
        // Worlds that are loaded but have no explicit section still need the dimension
        // default. The "default" section is overworld-shaped, so copying it verbatim to
        // the Nether/End would replace their lava sea / void with stone.
        if (environments != null) {
            for (Map.Entry<String, World.Environment> entry : environments.entrySet()) {
                if (worlds.containsKey(entry.getKey()) || !isNonOverworld(entry.getValue())) {
                    continue;
                }
                worlds.put(entry.getKey(), builtinDefault.withYShield(WorldSettings.YShield.disabled()));
                warnings.add("World '" + entry.getKey() + "': " + entry.getValue()
                        + " defaults to y-shield disabled; enable it explicitly to mask that dimension");
            }
        }
        if (worlds.isEmpty() && worldsSection == null) {
            warnings.add("No 'worlds' section found: secure built-in defaults are applied to every world");
        }

        PacketGatewaySettings gateway = new PacketGatewaySettings(minPeVersion);

        MiningSettings mining = new MiningSettings(
                cfg.getBoolean("analytics.mining.enabled", false),
                cfg.getDouble("analytics.mining.xray-ore-rate-threshold-percent", 5.0),
                Math.max(20, cfg.getInt("analytics.mining.min-samples", 200)),
                Math.max(4, cfg.getInt("analytics.mining.tunnel-streak-blocks", 24)),
                Math.max(0, cfg.getInt("analytics.mining.alert-cooldown-seconds", 120))
        );
        RaidSettings raid = new RaidSettings(
                cfg.getBoolean("analytics.raid.enabled", false),
                Math.max(0, cfg.getInt("analytics.raid.alert-cooldown-seconds", 300))
        );
        DebugSettings debug = new DebugSettings(
                cfg.getBoolean("debug.log-blocked-packets", false),
                cfg.getBoolean("debug.log-budget-overruns", true),
                cfg.getBoolean("debug.verbose-errors", false)
        );

        return new AegishiderConfig(revision, true, budgetMs, raycastBudget, gateway, builtinDefault, worlds,
                transparent, maxRaycastSegments, mining, raid, debug, warnings);
    }

    private static WorldSettings parseWorld(String worldName, ConfigurationSection section,
                                            List<String> warnings, boolean builtinDefault,
                                            World.Environment environment) {
        String bypassPermission = "aegishider.bypass";
        if (section != null) {
            bypassPermission = section.getString("bypass-permission", "aegishider.bypass");
            if (bypassPermission == null || bypassPermission.isBlank()) {
                warnings.add("World '" + worldName + "': empty bypass-permission; using aegishider.bypass");
                bypassPermission = "aegishider.bypass";
            }
        }

        // The "default" section of the config is itself the built-in fallback. When it is
        // absent, every world gets the same secure built-in block/item policy.
        if (section == null) {
            WorldSettings.YShield defaultYShield = isNonOverworld(environment)
                    ? WorldSettings.YShield.disabled()
                    : new WorldSettings.YShield(true, 40, 0, Material.STONE);
            return builtinDefault
                    ? new WorldSettings(true, bypassPermission, builtinBlockProtection(warnings, worldName),
                    builtinItemProtection(warnings, worldName), WorldSettings.PlayerProtection.disabled(),
                    new EntityHeightShield(true, 16.0, 50.0, 12.0),
                    defaultYShield,
                    WorldSettings.TunnelShield.disabled())
                    : WorldSettings.disabled(bypassPermission);
        }

        boolean enabled = section.getBoolean("enabled", true);
        if (!enabled) {
            warnings.add("World '" + worldName + "': protection disabled by configuration");
        }

        ConfigurationSection blockSection = section.getConfigurationSection("block-protection");
        List<String> hiddenNames;
        boolean blocksEnabled;
        Material replaceWith;
        boolean contextualFiller;
        double revealDistance;
        double blockFov;
        double keepFactor;
        int recheckMove;
        boolean reconcile;
        int reconcileChunksPerSecond;
        int reconcileRadius;

        if (blockSection != null) {
            hiddenNames = blockSection.getStringList("hidden-blocks");
            blocksEnabled = blockSection.getBoolean("enabled", true);
            String rawReplace = blockSection.getString("replace-with", "STONE");
            contextualFiller = rawReplace != null
                    && (rawReplace.equalsIgnoreCase("CONTEXTUAL") || rawReplace.equalsIgnoreCase("AUTO"));
            replaceWith = contextualFiller ? Material.STONE
                    : parseMaterial(rawReplace, Material.STONE,
                    warnings, worldName, "replace-with");
            revealDistance = clampDouble(blockSection.getDouble("reveal.max-distance", 24.0),
                    2.0, 64.0, warnings, worldName, "block-protection.reveal.max-distance");
            blockFov = clampDouble(blockSection.getDouble("reveal.fov-degrees", 360.0),
                    10.0, 360.0, warnings, worldName, "block-protection.reveal.fov-degrees");
            keepFactor = clampDouble(blockSection.getDouble("reveal.keep-distance-factor", 1.6),
                    1.0, 4.0, warnings, worldName, "block-protection.reveal.keep-distance-factor");
            recheckMove = clampInt(blockSection.getInt("reveal.recheck-move-blocks", 4),
                    1, 32, warnings, worldName, "block-protection.reveal.recheck-move-blocks");
            reconcile = blockSection.getBoolean("reconcile.enabled", true);
            reconcileChunksPerSecond = clampInt(blockSection.getInt("reconcile.chunks-per-second", 40),
                    1, 400, warnings, worldName, "block-protection.reconcile.chunks-per-second");
            reconcileRadius = clampInt(blockSection.getInt("reconcile.player-radius-chunks", 8),
                    1, 32, warnings, worldName, "block-protection.reconcile.player-radius-chunks");
        } else {
            // Legacy (v2/v3) format compatibility: hidden-blocks lived directly on the world.
            hiddenNames = section.getStringList("hidden-blocks");
            if (!hiddenNames.isEmpty()) {
                warnings.add("World '" + worldName + "': legacy 'hidden-blocks' format detected; "
                        + "migrated in memory (update config.yml to block-protection.hidden-blocks)");
                blocksEnabled = section.getBoolean("enabled", true);
            } else {
                hiddenNames = List.of(BUILTIN_HIDDEN_BLOCKS);
                blocksEnabled = true;
            }
            replaceWith = parseMaterial(section.getString("replace-with", "STONE"), Material.STONE,
                    warnings, worldName, "replace-with");
            contextualFiller = false;
            revealDistance = 24.0;
            blockFov = 360.0;
            keepFactor = 1.6;
            recheckMove = 4;
            reconcile = true;
            reconcileChunksPerSecond = 40;
            reconcileRadius = 8;
        }

        if (hiddenNames.isEmpty() && blocksEnabled) {
            // Fail closed: a block-protection section without hidden-blocks used to disable
            // protection with only a log warning. Fall back to the built-in set instead.
            hiddenNames = List.of(BUILTIN_HIDDEN_BLOCKS);
            warnings.add("World '" + worldName + "': block-protection.hidden-blocks is empty; "
                    + "using built-in defaults (add the key explicitly to choose your own set)");
        } else if (hiddenNames.isEmpty()) {
            warnings.add("World '" + worldName + "': no hidden-blocks configured, block protection inactive");
        }
        Set<Material> hiddenMaterials = MaterialSets.parseHiddenMaterials(hiddenNames, warnings, worldName);
        if (blocksEnabled && hiddenMaterials.isEmpty()) {
            warnings.add("World '" + worldName + "': no usable hidden-blocks; block protection inactive");
            blocksEnabled = false;
        }
        if (blocksEnabled && (!replaceWith.isBlock() || replaceWith.isAir() || !replaceWith.isSolid()
                || replaceWith == Material.WATER || replaceWith == Material.LAVA)) {
            warnings.add("World '" + worldName + "': replace-with=" + replaceWith
                    + " is not a solid non-liquid block; using STONE");
            replaceWith = Material.STONE;
        }
        if (blocksEnabled && MaterialSets.isDiscoverableBlockEntityMaterial(replaceWith)) {
            warnings.add("World '" + worldName + "': replace-with=" + replaceWith
                    + " has a block entity; clients would invent a fake container there, using STONE");
            replaceWith = Material.STONE;
        }

        BlockProtection blockProtection = new BlockProtection(
                blocksEnabled, hiddenMaterials, replaceWith, contextualFiller, revealDistance,
                blockFov, keepFactor, recheckMove, reconcile, reconcileChunksPerSecond,
                reconcileRadius);

        // ── Item / entity protection ───────────────────────────────────────
        ConfigurationSection itemSection = section.getConfigurationSection("item-protection");
        boolean itemsEnabled = itemSection == null || itemSection.getBoolean("enabled", true);
        // Every living mob (monsters AND animals/villagers) uses the same distance/Y/
        // occlusion policy by default. ItemShield keeps a hard 3-block interaction floor,
        // so farms and trading halls still have working hitboxes. Servers that prefer
        // visible animals can opt out with hide-all-living-entities: false; monsters
        // remain covered by the explicit list above in that case.
        boolean protectAllLiving = itemSection == null
                || itemSection.getBoolean("hide-all-living-entities", true);
        List<String> entityTypeNames = itemSection != null
                ? itemSection.getStringList("hidden-entity-types")
                : List.of();
        Set<EntityType> hiddenTypes = EnumSet.noneOf(EntityType.class);
        if (entityTypeNames.isEmpty()) {
            // An absent item section, or one without a list, must still hide hostile
            // mobs. Falling back to ITEM alone was a silent protection downgrade.
            hiddenTypes.addAll(BUILTIN_ITEM_TYPES);
            if (itemSection != null) {
                warnings.add("World '" + worldName + "': item-protection.hidden-entity-types is empty; "
                        + "using built-in item/hostile-mob defaults plus all-living protection");
            }
        } else {
            for (String raw : entityTypeNames) {
                if (raw == null || raw.isBlank()) {
                    continue;
                }
                try {
                    EntityType type = EntityType.valueOf(raw.trim().toUpperCase());
                    if (type == EntityType.PLAYER) {
                        warnings.add("World '" + worldName + "': PLAYER entity hiding is not supported "
                                + "(breaks teams/combat); entry ignored");
                        continue;
                    }
                    if (type == EntityType.UNKNOWN) {
                        warnings.add("World '" + worldName + "': ignored unknown entity type '" + raw + "'");
                        continue;
                    }
                    hiddenTypes.add(type);
                } catch (IllegalArgumentException ex) {
                    warnings.add("World '" + worldName + "': unknown entity type '" + raw + "' ignored");
                }
            }
        }
        if (hiddenTypes.isEmpty() && !protectAllLiving) {
            warnings.add("World '" + worldName + "': no usable hidden-entity-types; item protection inactive");
            itemsEnabled = false;
        }
        double itemDistance = itemSection != null
                ? clampDouble(itemSection.getDouble("reveal.max-distance", 24.0), 2.0, 96.0,
                warnings, worldName, "item-protection.reveal.max-distance")
                : 24.0;
        double itemFov = itemSection != null
                ? clampDouble(itemSection.getDouble("reveal.fov-degrees", 360.0), 10.0, 360.0,
                warnings, worldName, "item-protection.reveal.fov-degrees")
                : 360.0;
        boolean ownerGrace = itemSection == null || itemSection.getBoolean("reveal.owner-grace", true);
        int updateInterval = itemSection != null
                ? clampInt(itemSection.getInt("update-interval-ticks", 2), 1, 40,
                warnings, worldName, "item-protection.update-interval-ticks")
                : 2;
        boolean occlusionOnlyMonsters = itemSection == null
                || itemSection.getBoolean("monster-occlusion-only", true);
        double monsterMaxDistance = itemSection != null
                ? clampDouble(itemSection.getDouble("monster-max-distance", 96.0), 16.0, 256.0,
                warnings, worldName, "item-protection.monster-max-distance")
                : 96.0;
        // Light-medium wall check: beyond this very short melee radius a living mob must
        // prove a clear line of sight (body + head samples). A cow/monster directly behind
        // a solid wall is hidden; a pen behind a fence, glass or bars stays visible. Set 0
        // for strict at all ranges or 4 for the old close-range always-visible behaviour.
        double mobMeleeVisibleDistance = itemSection != null
                ? clampDouble(itemSection.getDouble("mob-melee-visible-distance", 3.0),
                0.0, 4.0, warnings, worldName,
                "item-protection.mob-melee-visible-distance")
                : 3.0;
        ItemProtection itemProtection = new ItemProtection(itemsEnabled, WorldSettings.copyEntityTypes(hiddenTypes),
                itemDistance, itemFov, ownerGrace, updateInterval, occlusionOnlyMonsters,
                monsterMaxDistance, mobMeleeVisibleDistance, protectAllLiving);

        // ── Player entity protection (anti player-ESP) ─────────────────────
        ConfigurationSection playerSection = section.getConfigurationSection("player-protection");
        boolean playersEnabled = playerSection != null && playerSection.getBoolean("enabled", false);
        boolean playerDistanceHiding = playerSection != null
                && playerSection.getBoolean("distance-hiding", false);
        double playerHideDistance = playerSection != null
                ? clampDouble(playerSection.getDouble("hide-distance", 48.0), 8.0, 256.0,
                warnings, worldName, "player-protection.hide-distance")
                : 48.0;
        double playerAlwaysVisible = playerSection != null
                ? clampDouble(playerSection.getDouble("always-visible-distance", 24.0), 2.0, 64.0,
                warnings, worldName, "player-protection.always-visible-distance")
                : 24.0;
        double playerFov = playerSection != null
                ? clampDouble(playerSection.getDouble("fov-degrees", 360.0), 10.0, 360.0,
                warnings, worldName, "player-protection.fov-degrees")
                : 360.0;
        boolean playerRequireLos = playerSection == null
                || playerSection.getBoolean("require-line-of-sight", true);
        boolean playerTeamAware = playerSection == null || playerSection.getBoolean("team-aware", true);
        int playerCombatGrace = playerSection != null
                ? clampInt(playerSection.getInt("combat-grace-seconds", 8), 0, 120,
                warnings, worldName, "player-protection.combat-grace-seconds")
                : 8;
        int playerInterval = playerSection != null
                ? clampInt(playerSection.getInt("update-interval-ticks", 4), 1, 40,
                warnings, worldName, "player-protection.update-interval-ticks")
                : 4;
        WorldSettings.PlayerProtection playerProtection = new WorldSettings.PlayerProtection(playersEnabled,
                playerDistanceHiding, playerHideDistance, playerAlwaysVisible, playerFov, playerRequireLos,
                playerTeamAware, playerCombatGrace, playerInterval);

        // ── Vertical (Y) separation shield for every entity ────────────────
        ConfigurationSection heightSection = section.getConfigurationSection("entity-height-shield");
        boolean heightEnabled = heightSection == null || heightSection.getBoolean("enabled", true);
        double heightMaxDistance = heightSection != null
                ? clampDouble(heightSection.getDouble("max-vertical-distance", 16.0), 2.0, 64.0,
                warnings, worldName, "entity-height-shield.max-vertical-distance")
                : 16.0;
        double heightUndergroundY = heightSection != null
                ? clampDouble(heightSection.getDouble("underground-y", 50.0), -256.0, 512.0,
                warnings, worldName, "entity-height-shield.underground-y")
                : 50.0;
        double heightBandMargin = heightSection != null
                ? clampDouble(heightSection.getDouble("band-margin", 12.0), 0.0, 64.0,
                warnings, worldName, "entity-height-shield.band-margin")
                : 12.0;
        EntityHeightShield entityHeightShield = new EntityHeightShield(heightEnabled, heightMaxDistance,
                heightUndergroundY, heightBandMargin);

        ConfigurationSection ySection = section.getConfigurationSection("y-shield");
        // Y-shield is part of the secure default: a surface viewer must not receive any
        // block below the configured line, including cave rooms whose containers were
        // already replaced. Servers that need the old distant-only behaviour can set
        // real-chunk-radius > 0; 0 masks every chunk in view.
        boolean yEnabled;
        if (ySection != null && ySection.contains("enabled")) {
            yEnabled = ySection.getBoolean("enabled", true);
        } else {
            // Nether/End are disabled by default: their terrain (lava sea, void) sits
            // below the overworld cut line, and masking it as stone breaks movement.
            yEnabled = !isNonOverworld(environment);
            if (!yEnabled) {
                warnings.add("World '" + worldName + "': y-shield defaults to disabled in "
                        + environment + " (enable it explicitly if this dimension needs it)");
            }
        }
        int yBelow = ySection != null
                ? clampInt(ySection.getInt("hide-below-y", 40), -256, 512,
                warnings, worldName, "y-shield.hide-below-y")
                : 40;
        int yRadius = ySection != null
                ? clampInt(ySection.getInt("real-chunk-radius", 0), 0, 16,
                warnings, worldName, "y-shield.real-chunk-radius")
                : 0;
        String rawYFiller = ySection != null ? ySection.getString("filler", "STONE") : "STONE";
        Material yFiller = parseMaterial(rawYFiller, Material.STONE, warnings, worldName,
                "y-shield.filler");
        if (yEnabled && (!yFiller.isBlock() || yFiller.isAir())) {
            warnings.add("World '" + worldName + "': y-shield.filler=" + yFiller
                    + " is not a solid block; using STONE");
            yFiller = Material.STONE;
        }
        if (yEnabled && MaterialSets.isDiscoverableBlockEntityMaterial(yFiller)) {
            warnings.add("World '" + worldName + "': y-shield.filler=" + yFiller
                    + " has a block entity; using STONE");
            yFiller = Material.STONE;
        }
        WorldSettings.YShield yShield = new WorldSettings.YShield(yEnabled, yBelow, yRadius, yFiller);

        ConfigurationSection tunnelSection = section.getConfigurationSection("tunnel-shield");
        boolean tunnelEnabled = tunnelSection != null && tunnelSection.getBoolean("enabled", false);
        double tunnelRadius = tunnelSection != null
                ? clampDouble(tunnelSection.getDouble("hide-radius", 28.0), 4.0, 128.0,
                warnings, worldName, "tunnel-shield.hide-radius")
                : 28.0;
        int tunnelMax = tunnelSection != null
                ? clampInt(tunnelSection.getInt("max-tracked-breaks", 50_000), 1_000, 500_000,
                warnings, worldName, "tunnel-shield.max-tracked-breaks")
                : 50_000;
        WorldSettings.TunnelShield tunnelShield = new WorldSettings.TunnelShield(tunnelEnabled,
                tunnelRadius, tunnelMax);

        return new WorldSettings(enabled, bypassPermission, blockProtection, itemProtection,
                playerProtection, entityHeightShield, yShield, tunnelShield);
    }

    private static BlockProtection builtinBlockProtection(List<String> warnings, String worldName) {
        Set<Material> materials = MaterialSets.parseHiddenMaterials(List.of(BUILTIN_HIDDEN_BLOCKS), warnings, worldName);
        return new BlockProtection(true, materials, Material.STONE, false, 24.0, 360.0, 1.6, 4,
                true, 40, 8);
    }

    private static ItemProtection builtinItemProtection(List<String> warnings, String worldName) {
        return new ItemProtection(true, WorldSettings.copyEntityTypes(BUILTIN_ITEM_TYPES),
                24.0, 360.0, true, 2, true, 96.0, 3.0, true);
    }

    private static boolean isNonOverworld(World.Environment environment) {
        return environment == World.Environment.NETHER || environment == World.Environment.THE_END;
    }

    private static Material parseMaterial(String raw, Material fallback, List<String> warnings,
                                          String worldName, String key) {
        if (raw == null || raw.isBlank()) {
            return fallback;
        }
        try {
            Material material = Material.valueOf(raw.trim().toUpperCase());
            if (!material.isBlock()) {
                warnings.add("World '" + worldName + "': " + key + "=" + raw + " is not a block; using "
                        + fallback);
                return fallback;
            }
            return material;
        } catch (IllegalArgumentException ex) {
            warnings.add("World '" + worldName + "': unknown material for " + key + "='" + raw
                    + "'; using " + fallback);
            return fallback;
        }
    }

    private static double clampDouble(double value, double min, double max, List<String> warnings,
                                      String worldName, String key) {
        if (Double.isNaN(value) || value < min || value > max) {
            double clamped = Double.isNaN(value) ? min : Math.max(min, Math.min(max, value));
            warnings.add("World '" + worldName + "': " + key + "=" + value + " out of range; using " + clamped);
            return clamped;
        }
        return value;
    }

    private static int clampInt(int value, int min, int max, List<String> warnings,
                                String worldName, String key) {
        if (value < min || value > max) {
            int clamped = Math.max(min, Math.min(max, value));
            warnings.add("World '" + worldName + "': " + key + "=" + value + " out of range; using " + clamped);
            return clamped;
        }
        return value;
    }
}
