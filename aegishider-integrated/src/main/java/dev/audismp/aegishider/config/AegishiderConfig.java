package dev.audismp.aegishider.config;

import org.bukkit.Material;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Immutable root configuration snapshot. The plugin replaces the whole object on
 * reload so no partially-reloaded state can be observed.
 */
public final class AegishiderConfig {

    public record PacketGatewaySettings(String minimumVersion) {
    }

    public record MiningSettings(boolean enabled, double xrayOreRatePercent, int minSamples,
                                 int tunnelStreakBlocks, int alertCooldownSeconds) {
        public static MiningSettings disabled() {
            return new MiningSettings(false, 5.0, 200, 24, 120);
        }
    }

    public record RaidSettings(boolean enabled, int alertCooldownSeconds) {
        public static RaidSettings disabled() {
            return new RaidSettings(false, 300);
        }
    }

    public record DebugSettings(boolean logBlockedPackets, boolean logBudgetOverruns, boolean verboseErrors) {
        public static DebugSettings defaults() {
            return new DebugSettings(false, true, false);
        }
    }

    private final long revision;
    private final boolean failClosed;
    private final double mainThreadBudgetMs;
    private final int raycastBudgetPerTick;
    private final PacketGatewaySettings packetGateway;
    private final WorldSettings defaultWorld;
    private final Map<String, WorldSettings> worlds;
    private final Set<Material> transparentBlocks;
    private final int maxRaycastSegments;
    private final MiningSettings mining;
    private final RaidSettings raid;
    private final DebugSettings debug;
    private final List<String> warnings;

    public AegishiderConfig(long revision, boolean failClosed, double mainThreadBudgetMs,
                           int raycastBudgetPerTick,
                           PacketGatewaySettings packetGateway, WorldSettings defaultWorld,
                           Map<String, WorldSettings> worlds, Set<Material> transparentBlocks,
                           int maxRaycastSegments, MiningSettings mining, RaidSettings raid,
                           DebugSettings debug, List<String> warnings) {
        this.revision = revision;
        this.failClosed = failClosed;
        this.mainThreadBudgetMs = mainThreadBudgetMs;
        this.raycastBudgetPerTick = raycastBudgetPerTick;
        this.packetGateway = packetGateway;
        this.defaultWorld = defaultWorld;
        this.worlds = Collections.unmodifiableMap(new LinkedHashMap<>(worlds));
        this.transparentBlocks = transparentBlocks;
        this.maxRaycastSegments = maxRaycastSegments;
        this.mining = mining;
        this.raid = raid;
        this.debug = debug;
        this.warnings = List.copyOf(warnings);
    }

    public long revision() { return revision; }
    public boolean failClosed() { return failClosed; }
    public double mainThreadBudgetMs() { return mainThreadBudgetMs; }
    public int raycastBudgetPerTick() { return raycastBudgetPerTick; }
    public PacketGatewaySettings packetGateway() { return packetGateway; }
    public WorldSettings defaultWorld() { return defaultWorld; }
    public Map<String, WorldSettings> worlds() { return worlds; }
    public Set<Material> transparentBlocks() { return transparentBlocks; }
    public int maxRaycastSegments() { return maxRaycastSegments; }
    public MiningSettings mining() { return mining; }
    public RaidSettings raid() { return raid; }
    public DebugSettings debug() { return debug; }
    public List<String> warnings() { return warnings; }

    /** Returns the settings for a world (falls back to the {@code default} section). */
    public WorldSettings world(String worldName) {
        WorldSettings exact = worlds.get(worldName);
        return exact != null ? exact : defaultWorld;
    }

    public boolean isWorldEnabled(String worldName) {
        return world(worldName).isEnabled();
    }

    public boolean anyBlockProtectionEnabled() {
        if (defaultWorld.blocksEnabled()) {
            return true;
        }
        for (WorldSettings settings : worlds.values()) {
            if (settings.blocksEnabled()) {
                return true;
            }
        }
        return false;
    }

    public boolean anyItemProtectionEnabled() {
        if (defaultWorld.itemsEnabled()) {
            return true;
        }
        for (WorldSettings settings : worlds.values()) {
            if (settings.itemsEnabled()) {
                return true;
            }
        }
        return false;
    }

    public boolean anyProtectionEnabled() {
        return anyBlockProtectionEnabled() || anyItemProtectionEnabled();
    }
}
