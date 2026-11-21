package dev.audismp.aegishider.util;

import dev.audismp.aegishider.config.WorldSettings;

import org.bukkit.Material;

import java.util.Collections;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * Resolver for material/pattern lists used by the visibility engine.
 *
 * <p>Tile-entity backed materials are discovered from world block entities. Plain
 * {@code BOOKSHELF} is the explicit state-scan exception because it has no block entity;
 * its positions come from the packet layer's palette-prefiltered state scan and targeted
 * index verification, not a full world scan. Other unsupported {@code hidden-blocks}
 * entries are rejected with a warning instead of silently producing a partial protection
 * guarantee.
 */
public final class MaterialSets {

    private MaterialSets() {
    }

    /**
     * Blocks with no block entity that still need a block-state hiding path. These are
     * deliberately few: the packet layer can spot their states through a chunk section
     * palette, but the main-thread index only learns positions from packet detection,
     * player placement and targeted re-verification (never from a full world scan).
     */
    private static final Set<Material> EXPLICIT_STATE_ONLY_MATERIALS = EnumSet.of(
            Material.BOOKSHELF
    );

    private static final Set<Material> EXPLICIT_TILE_ENTITY_MATERIALS = EnumSet.of(
            Material.CHEST, Material.TRAPPED_CHEST, Material.ENDER_CHEST, Material.BARREL,
            Material.HOPPER, Material.DROPPER, Material.DISPENSER,
            Material.FURNACE, Material.BLAST_FURNACE, Material.SMOKER,
            Material.BREWING_STAND, Material.SPAWNER, Material.TRIAL_SPAWNER, Material.VAULT,
            Material.BEACON, Material.CONDUIT, Material.LECTERN, Material.JUKEBOX,
            Material.CAMPFIRE, Material.SOUL_CAMPFIRE, Material.DECORATED_POT,
            Material.CHISELED_BOOKSHELF, Material.CRAFTER, Material.ENCHANTING_TABLE,
            Material.NOTE_BLOCK, Material.PISTON, Material.STICKY_PISTON, Material.MOVING_PISTON,
            Material.DAYLIGHT_DETECTOR, Material.BEEHIVE, Material.BEE_NEST,
            Material.SCULK_SENSOR, Material.CALIBRATED_SCULK_SENSOR, Material.SCULK_SHRIEKER,
            Material.SUSPICIOUS_SAND, Material.SUSPICIOUS_GRAVEL,
            Material.END_GATEWAY, Material.END_PORTAL,
            Material.COMMAND_BLOCK, Material.CHAIN_COMMAND_BLOCK, Material.REPEATING_COMMAND_BLOCK,
            Material.STRUCTURE_BLOCK, Material.JIGSAW
    );

    /** Returns true if the material is backed by a block entity and can be discovered from chunks. */
    public static boolean isDiscoverableBlockEntityMaterial(Material material) {
        if (material == null || material.isLegacy()) {
            return false;
        }
        if (!material.isBlock()) {
            return false;
        }
        if (EXPLICIT_TILE_ENTITY_MATERIALS.contains(material)) {
            return true;
        }
        String name = material.name();
        return name.endsWith("_SHULKER_BOX")
                || name.equals("SHULKER_BOX")
                || name.endsWith("_SIGN") || name.endsWith("_HANGING_SIGN")
                || name.endsWith("_BANNER")
                || name.endsWith("_HEAD") || name.endsWith("_SKULL")
                || name.endsWith("_BED");
    }

    /** Returns true for a plain block hidden through block-state scanning (no block entity). */
    public static boolean isStateOnlyHiddenMaterial(Material material) {
        return material != null && material.isBlock() && !material.isLegacy()
                && EXPLICIT_STATE_ONLY_MATERIALS.contains(material);
    }

    /** Returns true when at least one configured material needs the block-state scan path. */
    public static boolean hasStateOnlyHiddenMaterials(Set<Material> materials) {
        if (materials == null || materials.isEmpty()) {
            return false;
        }
        for (Material material : materials) {
            if (isStateOnlyHiddenMaterial(material)) {
                return true;
            }
        }
        return false;
    }

    /** State-scanned materials from a configured hidden set. */
    public static Set<Material> stateOnlyHiddenMaterials(Set<Material> materials) {
        if (materials == null || materials.isEmpty()) {
            return Collections.emptySet();
        }
        Set<Material> result = EnumSet.noneOf(Material.class);
        for (Material material : materials) {
            if (isStateOnlyHiddenMaterial(material)) {
                result.add(material);
            }
        }
        return result.isEmpty() ? Collections.emptySet() : Collections.unmodifiableSet(result);
    }

    /** Bare lowercase names used by the packet-layer state scan. */
    public static Set<String> stateOnlyHiddenNames(Set<Material> materials) {
        Set<Material> stateOnly = stateOnlyHiddenMaterials(materials);
        if (stateOnly.isEmpty()) {
            return Collections.emptySet();
        }
        Set<String> names = new HashSet<>(stateOnly.size() * 2);
        for (Material material : stateOnly) {
            names.add(material.name().toLowerCase(java.util.Locale.ROOT));
        }
        return Collections.unmodifiableSet(names);
    }

    /**
     * Vanilla block-entity registry names that differ from the block material name.
     * The registry name is what the client uses in the chunk's block-entity list and
     * in {@code block_entity_data} packets, so protection must match on these names,
     * not on the block state id (which may fail to resolve for future/unknown states).
     */
    private static final Map<Material, String> TILE_ENTITY_TYPE_OVERRIDES = new EnumMap<>(Material.class);

    static {
        TILE_ENTITY_TYPE_OVERRIDES.put(Material.SPAWNER, "mob_spawner");
        TILE_ENTITY_TYPE_OVERRIDES.put(Material.NOTE_BLOCK, "noteblock");
        TILE_ENTITY_TYPE_OVERRIDES.put(Material.CAMPFIRE, "campfire");
        TILE_ENTITY_TYPE_OVERRIDES.put(Material.SOUL_CAMPFIRE, "campfire");
        TILE_ENTITY_TYPE_OVERRIDES.put(Material.BEE_NEST, "beehive");
        TILE_ENTITY_TYPE_OVERRIDES.put(Material.SUSPICIOUS_SAND, "suspicious_sand");
        TILE_ENTITY_TYPE_OVERRIDES.put(Material.SUSPICIOUS_GRAVEL, "suspicious_gravel");
        TILE_ENTITY_TYPE_OVERRIDES.put(Material.MOVING_PISTON, "piston");
        TILE_ENTITY_TYPE_OVERRIDES.put(Material.SCULK_CATALYST, "sculk_catalyst");
    }

    /**
     * Resolves the vanilla block-entity type name for a material, or {@code null} when
     * the material has no block entity.
     */
    public static String tileEntityTypeName(Material material) {
        if (!isDiscoverableBlockEntityMaterial(material)) {
            return null;
        }
        String override = TILE_ENTITY_TYPE_OVERRIDES.get(material);
        if (override != null) {
            return override;
        }
        String name = material.name();
        if (name.endsWith("_HANGING_SIGN")) {
            return "hanging_sign";
        }
        if (name.endsWith("_SIGN")) {
            return "sign";
        }
        if (name.endsWith("_BANNER")) {
            return "banner";
        }
        if (name.endsWith("_HEAD") || name.endsWith("_SKULL")) {
            return "skull";
        }
        if (name.endsWith("_BED")) {
            return "bed";
        }
        if (name.endsWith("_SHULKER_BOX") || name.equals("SHULKER_BOX")) {
            return "shulker_box";
        }
        if (name.equals("PISTON") || name.equals("STICKY_PISTON")) {
            return "piston";
        }
        if (name.equals("CHAIN_COMMAND_BLOCK") || name.equals("REPEATING_COMMAND_BLOCK")) {
            return "command_block";
        }
        return name.toLowerCase(java.util.Locale.ROOT);
    }

    /** Collects the distinct block-entity type names for a set of materials. */
    public static Set<String> tileEntityTypeNames(Set<Material> materials) {
        if (materials == null || materials.isEmpty()) {
            return Collections.emptySet();
        }
        Set<String> names = new HashSet<>(materials.size() * 2);
        for (Material material : materials) {
            String name = tileEntityTypeName(material);
            if (name != null) {
                names.add(name);
            }
        }
        return Collections.unmodifiableSet(names);
    }

    /**
     * Parses configured hidden block materials, dropping (and reporting) entries that
     * cannot be discovered/hidden reliably.
     */
    public static Set<Material> parseHiddenMaterials(List<String> names, List<String> warnings, String worldName) {
        if (names == null || names.isEmpty()) {
            return Collections.emptySet();
        }
        Set<Material> result = EnumSet.noneOf(Material.class);
        Set<String> rejected = new TreeSet<>();
        for (String raw : names) {
            if (raw == null || raw.isBlank()) {
                continue;
            }
            Material material;
            try {
                material = Material.valueOf(raw.trim().toUpperCase());
            } catch (IllegalArgumentException ex) {
                rejected.add(raw + " (unknown material)");
                continue;
            }
            if (!material.isBlock()) {
                rejected.add(raw + " (not a block)");
                continue;
            }
            if (!isDiscoverableBlockEntityMaterial(material) && !isStateOnlyHiddenMaterial(material)) {
                rejected.add(raw + " (not a tile-entity or state-scanned block; cannot be discovered reliably)");
                continue;
            }
            result.add(material);
        }
        if (!rejected.isEmpty()) {
            warnings.add("World '" + worldName + "': ignored hidden-blocks entries: " + String.join(", ", rejected));
        }
        return WorldSettings.copyMaterials(result);
    }

    /**
     * Resolves a list of exact names or {@code PREFIX*} / {@code *SUFFIX} patterns into
     * materials. Unknown patterns are reported.
     */
    public static Set<Material> resolvePatterns(List<String> patterns, List<String> warnings, String key,
                                                Set<Material> defaults) {
        if (patterns == null || patterns.isEmpty()) {
            return Collections.unmodifiableSet(EnumSet.copyOf(defaults));
        }
        Set<Material> result = EnumSet.noneOf(Material.class);
        Set<String> unknown = new TreeSet<>();
        for (String raw : patterns) {
            if (raw == null || raw.isBlank()) {
                continue;
            }
            String pattern = raw.trim().toUpperCase();
            boolean matched = false;
            for (Material material : Material.values()) {
                if (material.isLegacy() || !material.isBlock()) {
                    continue;
                }
                if (matches(material.name(), pattern)) {
                    result.add(material);
                    matched = true;
                }
            }
            if (!matched) {
                unknown.add(raw);
            }
        }
        if (!unknown.isEmpty()) {
            warnings.add(key + ": patterns matched no block material: " + String.join(", ", unknown));
        }
        if (result.isEmpty()) {
            return Collections.unmodifiableSet(EnumSet.copyOf(defaults));
        }
        return Collections.unmodifiableSet(result);
    }

    private static boolean matches(String name, String pattern) {
        if (pattern.indexOf('*') < 0) {
            return name.equals(pattern);
        }
        if (pattern.startsWith("*") && pattern.endsWith("*")) {
            return name.contains(pattern.substring(1, pattern.length() - 1));
        }
        if (pattern.startsWith("*")) {
            return name.endsWith(pattern.substring(1));
        }
        if (pattern.endsWith("*")) {
            return name.startsWith(pattern.substring(0, pattern.length() - 1));
        }
        return name.equals(pattern);
    }

    /**
     * Vanilla blocks a player can see through. Used by the ray tracer to continue a ray
     * past glass-like blocks instead of treating them as occlusion. Deliberately
     * conservative: anything not listed occludes.
     *
     * <p>Thin see-through blocks are included because treating them as solid walls hid
     * animals inside fence pens, villagers behind iron bars, players peeking over a low
     * wall and chests visible through a fence. They are visually transparent even though
     * their collision shapes are not. Solid doors, trapdoors and leaves deliberately stay
     * opaque.
     */
    public static Set<Material> defaultTransparentBlocks() {
        Set<Material> result = EnumSet.noneOf(Material.class);
        for (Material material : Material.values()) {
            if (material.isLegacy() || !material.isBlock()) {
                continue;
            }
            String name = material.name();
            if (name.equals("WATER") || name.equals("BUBBLE_COLUMN")
                    || name.equals("GLASS") || name.equals("GLASS_PANE")
                    || name.equals("ICE") || name.equals("FROSTED_ICE")
                    || name.equals("SLIME_BLOCK") || name.equals("HONEY_BLOCK")
                    || name.equals("NETHER_PORTAL")
                    || name.equals("CHAIN") || name.endsWith("_CHAIN")
                    || name.endsWith("_GLASS") || name.endsWith("_GLASS_PANE")
                    || name.endsWith("_FENCE") || name.endsWith("_FENCE_GATE")
                    || name.endsWith("_BARS") || name.endsWith("_WALL")) {
                result.add(material);
            }
        }
        return Collections.unmodifiableSet(result);
    }
}
