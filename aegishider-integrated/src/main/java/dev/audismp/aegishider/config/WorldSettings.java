package dev.audismp.aegishider.config;

import dev.audismp.aegishider.util.EntityTypeUtil;
import org.bukkit.Material;
import org.bukkit.entity.EntityType;

import java.util.Collections;
import java.util.EnumSet;
import java.util.Set;

/**
 * Immutable per-world visibility policy. Built by {@link ConfigLoader} and replaced
 * atomically on {@code /aegishider reload}.
 */
public final class WorldSettings {

    /**
     * Cosine of half the configured field-of-view angle. A negative value is the
     * explicit "FOV gate disabled" sentinel for {@code fovDegrees >= 360}; callers
     * must treat it as "everything is in view" instead of applying a cone.
     *
     * <p>180 degrees is the useful maximum for a cone: it is the front hemisphere and
     * covers every normal screen aspect ratio. 360 disables the gate completely so a
     * third-person front view (F5 twice) and fast turns cannot hide objects that are
     * visibly on screen.
     */
    public static double fovCosHalfFor(double fovDegrees) {
        if (fovDegrees >= 360.0) {
            return -1.0;
        }
        // Only 360 is the disabled sentinel. Any angle below it remains a cone; values
        // above 180 are clamped to the front hemisphere because a larger cone has no
        // useful screen-aspect meaning.
        double half = Math.min(180.0, Math.max(0.0, fovDegrees)) / 2.0;
        return Math.cos(Math.toRadians(half));
    }

    public record BlockProtection(
            boolean enabled,
            Set<Material> hiddenMaterials,
            Material replaceWith,
            boolean contextualFiller,
            double revealDistance,
            double fovDegrees,
            double keepDistanceFactor,
            int recheckMoveBlocks,
            boolean reconcileEnabled,
            int reconcileChunksPerSecond,
            int reconcilePlayerRadiusChunks
    ) {
        public boolean isHiddenMaterial(Material material) {
            return enabled && hiddenMaterials.contains(material);
        }

        /** Cosine of the half FOV angle; negative means the FOV gate is disabled. */
        public double fovCosHalf() {
            return WorldSettings.fovCosHalfFor(fovDegrees);
        }
    }

    public record ItemProtection(
            boolean enabled,
            Set<EntityType> hiddenEntityTypes,
            double revealDistance,
            double fovDegrees,
            boolean ownerGrace,
            int updateIntervalTicks,
            boolean occlusionOnlyMonsters,
            double monsterMaxDistance,
            double mobMeleeVisibleDistance,
            boolean protectAllLiving
    ) {
        public boolean isHiddenType(EntityType type) {
            return enabled && (hiddenEntityTypes.contains(type)
                    || (protectAllLiving && EntityTypeUtil.isLivingMobType(type)));
        }

        public double fovCosHalf() {
            return WorldSettings.fovCosHalfFor(fovDegrees);
        }
    }

    /**
     * Distance-only Y-level shield: when the viewer is above {@code hideBelowY}, chunks
     * farther than {@code realChunkRadius} chunks have every section below {@code hideBelowY}
     * replaced by a solid filler, hiding caves and underground bases from the surface view.
     */
    public record YShield(boolean enabled, int hideBelowY, int realChunkRadius, Material filler) {
        /**
         * Safety gap above the cut line. A player standing on the line must keep their own
         * feet/body space real, otherwise the client can receive filler inside its own
         * collision box and rubber-band while walking at the threshold.
         */
        public static final double VIEWER_MARGIN = 2.0;

        /**
         * Minimum eye-to-entity vertical gap before the Y-shield may hide an entity.
         * A normal floor/step is 0-2 blocks, and two players on the same floor must not
         * disappear from each other just because one is a block lower near the cut line.
         */
        public static final double ENTITY_MIN_VERTICAL_GAP = 4.0;

        /** True when this viewer is high enough above the line to receive a masked world. */
        public boolean masksViewer(double eyeY) {
            return enabled && eyeY >= hideBelowY + VIEWER_MARGIN;
        }

        /** True when this chunk should be masked for the viewer's current chunk position. */
        public boolean masksChunk(int chunkX, int chunkZ, int viewerChunkX, int viewerChunkZ) {
            if (!enabled) {
                return false;
            }
            if (realChunkRadius <= 0) {
                return true;
            }
            return Math.abs(chunkX - viewerChunkX) > realChunkRadius
                    || Math.abs(chunkZ - viewerChunkZ) > realChunkRadius;
        }

        /** True when a block at {@code y} must be filler for this viewer. */
        public boolean masksBlock(double eyeY, int y) {
            return masksViewer(eyeY) && y < hideBelowY;
        }

        /** True when an entity at {@code entityY} must be hidden for this viewer. */
        public boolean masksEntity(double eyeY, double entityY) {
            if (!masksViewer(eyeY) || entityY >= hideBelowY) {
                return false;
            }
            // Dead band: eye and entity on the same floor stay visible. Without this a
            // player at eye 42.1 could not see a friend standing at y=39 in the same
            // open room, which is a false hide and a PvP fairness bug.
            return eyeY - entityY >= ENTITY_MIN_VERTICAL_GAP;
        }

        /**
         * Block-update variant: air removals must never be rewritten to the filler.
         * Replacing air with the filler resurrects a mined block (ghost block).
         */
        public boolean masksBlockUpdate(double eyeY, int y, int stateId) {
            return stateId != 0 && masksBlock(eyeY, y);
        }

        public static YShield disabled() {
            return new YShield(false, 40, 0, Material.STONE);
        }
    }

    public record PlayerProtection(
            boolean enabled,
            boolean distanceHiding,
            double hideDistance,
            double alwaysVisibleDistance,
            double fovDegrees,
            boolean requireLineOfSight,
            boolean teamAware,
            int combatGraceSeconds,
            int updateIntervalTicks
    ) {
        public double fovCosHalf() {
            return WorldSettings.fovCosHalfFor(fovDegrees);
        }

        public static PlayerProtection disabled() {
            return new PlayerProtection(false, false, 48.0, 24.0, 360.0, true, true, 8, 4);
        }
    }

    /**
     * Vertical (Y) separation shield for players and living mobs (monsters, animals,
     * villagers, golems...). A viewer only receives those entities when the vertical gap
     * from the viewer's eye is within {@code maxVerticalDistance} and at least one side is
     * at or below {@code undergroundY}. The underground gate keeps the anti-base rule for
     * deep bases while not hiding ordinary surface gameplay on mountains, towers, or while
     * flying. Same-floor gameplay is unaffected (a normal floor/step is 0-2 blocks).
     * Dropped items, item frames and minecarts are not affected by this shield.
     */
    public record EntityHeightShield(boolean enabled, double maxVerticalDistance,
                                     double undergroundY, double bandMargin) {

        /** True when the hard vertical band forbids this eye/entity pair. */
        public boolean separates(double eyeY, double targetCenterY) {
            if (!enabled || Math.abs(targetCenterY - eyeY) <= maxVerticalDistance) {
                return false;
            }
            double lower = Math.min(eyeY, targetCenterY);
            double upper = Math.max(eyeY, targetCenterY);
            if (undergroundY >= 512.0) {
                // Legacy opt-in: any vertical gap is treated as a floor separation.
                return lower <= undergroundY;
            }
            // Only a genuinely underground target viewed from genuinely above-ground
            // counts as a floor/base separation. The dead band around underground-y keeps
            // a ravine, mineshaft or cliff at y=40/70 visible when both sides can see each
            // other; mountains, towers and elytra flight stay visible as before.
            return lower <= undergroundY - bandMargin && upper >= undergroundY + bandMargin;
        }

        public static EntityHeightShield disabled() {
            return new EntityHeightShield(false, 16.0, 50.0, 12.0);
        }
    }

    /**
     * Tunnel/dug-hole shield: blocks mined by players are remembered with their original
     * material. A viewer farther than {@code hideRadius} blocks receives the original block
     * instead of the new air, so a distant cheat client cannot see player-dug tunnels. When
     * the viewer approaches, the real air is revealed.
     */
    public record TunnelShield(boolean enabled, double hideRadius, int maxTrackedBreaks) {
        public static TunnelShield disabled() {
            return new TunnelShield(false, 28.0, 50_000);
        }
    }

    private final boolean enabled;
    private final String bypassPermission;
    private final BlockProtection blockProtection;
    private final ItemProtection itemProtection;
    private final PlayerProtection playerProtection;
    private final EntityHeightShield entityHeightShield;
    private final YShield yShield;
    private final TunnelShield tunnelShield;

    public WorldSettings(boolean enabled, String bypassPermission,
                         BlockProtection blockProtection, ItemProtection itemProtection,
                         PlayerProtection playerProtection, EntityHeightShield entityHeightShield,
                         YShield yShield, TunnelShield tunnelShield) {
        this.enabled = enabled;
        this.bypassPermission = bypassPermission;
        this.blockProtection = blockProtection;
        this.itemProtection = itemProtection;
        this.playerProtection = playerProtection;
        this.entityHeightShield = entityHeightShield;
        this.yShield = yShield;
        this.tunnelShield = tunnelShield;
    }

    public static WorldSettings disabled(String bypassPermission) {
        return new WorldSettings(false, bypassPermission,
                new BlockProtection(false, Collections.emptySet(), Material.STONE, false,
                        24.0, 360.0, 1.6, 4, false, 40, 8),
                new ItemProtection(false, Collections.<EntityType>emptySet(), 24.0, 360.0, true, 2,
                        true, 96.0, 1.0, true),
                PlayerProtection.disabled(), EntityHeightShield.disabled(), YShield.disabled(),
                TunnelShield.disabled());
    }

    public boolean isEnabled() {
        return enabled;
    }

    public String bypassPermission() {
        return bypassPermission;
    }

    public BlockProtection blockProtection() {
        return blockProtection;
    }

    public ItemProtection itemProtection() {
        return itemProtection;
    }

    public PlayerProtection playerProtection() {
        return playerProtection;
    }

    public EntityHeightShield entityHeightShield() {
        return entityHeightShield;
    }

    public YShield yShield() {
        return yShield;
    }

    public TunnelShield tunnelShield() {
        return tunnelShield;
    }

    /** Returns a copy of these world settings with a different Y-shield policy. */
    public WorldSettings withYShield(YShield shield) {
        return new WorldSettings(enabled, bypassPermission, blockProtection, itemProtection,
                playerProtection, entityHeightShield, shield, tunnelShield);
    }

    /** Convenience: set of materials hidden in this world (empty when disabled). */
    public Set<Material> hiddenMaterials() {
        return blockProtection.enabled() ? blockProtection.hiddenMaterials() : Collections.emptySet();
    }

    public Set<EntityType> hiddenEntityTypes() {
        return itemProtection.enabled() ? itemProtection.hiddenEntityTypes() : Collections.<EntityType>emptySet();
    }

    public boolean blocksEnabled() {
        return enabled && blockProtection.enabled() && !blockProtection.hiddenMaterials().isEmpty();
    }

    public boolean itemsEnabled() {
        return enabled && itemProtection.enabled()
                && (!itemProtection.hiddenEntityTypes().isEmpty() || itemProtection.protectAllLiving());
    }

    public static Set<Material> copyMaterials(Set<Material> source) {
        return source.isEmpty() ? Collections.emptySet() : Collections.unmodifiableSet(EnumSet.copyOf(source));
    }

    public static Set<EntityType> copyEntityTypes(Set<EntityType> source) {
        return source.isEmpty() ? Collections.emptySet() : Collections.unmodifiableSet(EnumSet.copyOf(source));
    }
}
