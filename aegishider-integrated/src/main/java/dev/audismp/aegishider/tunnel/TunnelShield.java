package dev.audismp.aegishider.tunnel;

import com.github.retrooper.packetevents.protocol.player.ClientVersion;
import com.github.retrooper.packetevents.protocol.world.chunk.BaseChunk;
import com.github.retrooper.packetevents.protocol.world.chunk.Column;
import com.github.retrooper.packetevents.protocol.world.states.WrappedBlockState;
import dev.audismp.aegishider.AegishiderPlugin;
import dev.audismp.aegishider.config.WorldSettings;
import dev.audismp.aegishider.core.TimeBudget;
import dev.audismp.aegishider.core.WorldKeys;
import dev.audismp.aegishider.metrics.Metrics;
import dev.audismp.aegishider.util.BlockPosUtil;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Tunnel / dug-hole shield.
 *
 * <p>When a player mines a block, the original block state is remembered (bounded). A viewer
 * farther than {@code hide-radius} receives the original block instead of air in chunk and
 * block-change packets, so distant cheat clients cannot see player-dug tunnels or holes.
 * When the viewer walks close, the real air is sent; walking away masks it again.
 *
 * <p>Threading: recording happens on the main thread; reads happen on the packet thread.
 * All maps are concurrent and the per-chunk position sets are guarded by {@code synchronized}.
 */
public final class TunnelShield {

    /** Outgoing chunks/block states are always encoded in the server protocol version. */
    private volatile ClientVersion protocolVersion = ClientVersion.V_1_21_4;

    /** Called by the packet gateway once the server version is known (1.21.1 - 1.21.11). */
    public void setProtocolVersion(ClientVersion version) {
        if (version != null) {
            this.protocolVersion = version;
        }
    }
    private static final class WorldTunnels {
        final ConcurrentHashMap<Long, Integer> originalState = new ConcurrentHashMap<>();
        final ConcurrentHashMap<Long, String> originalName = new ConcurrentHashMap<>();
        final ConcurrentHashMap<Long, Set<Long>> byChunk = new ConcurrentHashMap<>();
    }

    private final AegishiderPlugin plugin;
    private final Metrics metrics;
    private final ConcurrentHashMap<Long, WorldTunnels> worlds = new ConcurrentHashMap<>();
    private final AtomicInteger total = new AtomicInteger();
    private final Map<UUID, Set<Long>> revealedByViewer = new ConcurrentHashMap<>();
    private int viewerCursor;

    public TunnelShield(AegishiderPlugin plugin, Metrics metrics) {
        this.plugin = plugin;
        this.metrics = metrics;
    }

    // ── main-thread recording ───────────────────────────────────────────────

    public void recordBreak(World world, Block block, WorldSettings settings) {
        WorldSettings.TunnelShield config = settings.tunnelShield();
        if (!config.enabled() || total.get() >= config.maxTrackedBreaks()) {
            return;
        }
        Material type = block.getType();
        if (type.isAir() || !type.isSolid() || type == Material.WATER || type == Material.LAVA) {
            return;
        }
        if (settings.blockProtection().isHiddenMaterial(type)) {
            return; // containers are covered by the block shield (do not fake them back)
        }
        int stateId = defaultStateId(type);
        if (stateId <= 0) {
            return;
        }
        long worldId = WorldKeys.idOf(world);
        long pos = BlockPosUtil.encode(block.getX(), block.getY(), block.getZ());
        long chunkKey = BlockPosUtil.chunkKeyOfBlock(worldId, pos);
        WorldTunnels tunnels = worlds.computeIfAbsent(worldId, id -> new WorldTunnels());
        if (tunnels.originalState.putIfAbsent(pos, stateId) != null) {
            return;
        }
        tunnels.originalName.put(pos, type.name().toLowerCase());
        Set<Long> positions = tunnels.byChunk.computeIfAbsent(chunkKey, k -> ConcurrentHashMap.newKeySet());
        synchronized (positions) {
            positions.add(pos);
        }
        if (total.incrementAndGet() > config.maxTrackedBreaks()) {
            remove(worldId, pos); // never exceed the cap
        }
    }

    public void removeAt(World world, Block block) {
        remove(WorldKeys.idOf(world), BlockPosUtil.encode(block.getX(), block.getY(), block.getZ()));
    }

    private void remove(long worldId, long pos) {
        WorldTunnels tunnels = worlds.get(worldId);
        if (tunnels == null) {
            return;
        }
        Integer removed = tunnels.originalState.remove(pos);
        tunnels.originalName.remove(pos);
        if (removed == null) {
            return;
        }
        long chunkKey = BlockPosUtil.chunkKeyOfBlock(worldId, pos);
        Set<Long> positions = tunnels.byChunk.get(chunkKey);
        if (positions != null) {
            synchronized (positions) {
                positions.remove(pos);
                if (positions.isEmpty()) {
                    tunnels.byChunk.remove(chunkKey);
                }
            }
        }
        total.decrementAndGet();
    }

    public int trackedCount() {
        return total.get();
    }

    /** Fast-path guard: does this chunk contain a tracked tunnel position? */
    public boolean hasTunnelsInChunk(long worldId, int chunkX, int chunkZ) {
        WorldTunnels tunnels = worlds.get(worldId);
        if (tunnels == null) {
            return false;
        }
        Set<Long> positions = tunnels.byChunk.get(BlockPosUtil.chunkKey(worldId, chunkX, chunkZ));
        return positions != null && !positions.isEmpty();
    }

    // ── packet-thread masking ──────────────────────────────────────────────

    /** Applies the tunnel mask to one outgoing chunk. Returns the number of changed blocks. */
    public int maskColumn(Column column, Player viewer, long worldId, int chunkX, int chunkZ,
                          int minSectionY, WorldSettings.TunnelShield config) {
        if (!config.enabled() || viewer == null) {
            return 0;
        }
        WorldTunnels tunnels = worlds.get(worldId);
        if (tunnels == null) {
            return 0;
        }
        long chunkKey = BlockPosUtil.chunkKey(worldId, chunkX, chunkZ);
        Set<Long> positions = tunnels.byChunk.get(chunkKey);
        if (positions == null) {
            return 0;
        }
        List<Long> snapshot;
        synchronized (positions) {
            snapshot = new ArrayList<>(positions);
        }
        if (snapshot.isEmpty()) {
            return 0;
        }
        BaseChunk[] sections = column.getChunks();
        if (sections == null) {
            return 0;
        }
        // Packet thread: never call Player#getEyeLocation()/getWorld() here. Use the
        // volatile eye snapshot maintained on the main thread instead.
        var session = plugin.sessions().get(viewer.getUniqueId());
        if (session == null) {
            return 0;
        }
        double radiusSq = config.hideRadius() * config.hideRadius();
        int changed = 0;
        for (long pos : snapshot) {
            Integer original = tunnels.originalState.get(pos);
            if (original == null || original <= 0) {
                continue;
            }
            int x = BlockPosUtil.decodeX(pos);
            int y = BlockPosUtil.decodeY(pos);
            int z = BlockPosUtil.decodeZ(pos);
            double dx = (x + 0.5) - session.eyeX();
            double dy = (y + 0.5) - session.eyeY();
            double dz = (z + 0.5) - session.eyeZ();
            if (dx * dx + dy * dy + dz * dz <= radiusSq) {
                continue;
            }
            int sectionIndex = (y >> 4) - minSectionY;
            if (sectionIndex < 0 || sectionIndex >= sections.length) {
                continue;
            }
            BaseChunk section = sections[sectionIndex];
            if (section == null) {
                continue;
            }
            int state = section.getBlockId(x & 15, y & 15, z & 15);
            if (state != 0) {
                continue; // already a real block: nothing to hide
            }
            section.set(x & 15, y & 15, z & 15, original);
            changed++;
        }
        if (changed > 0) {
            metrics.recordTunnelBlockMasked();
        }
        return changed;
    }

    /**
     * Rewrites an outgoing air block change for a distant viewer to the original material.
     * @return replacement state id, or -1 when the update must be left untouched
     */
    public int maskBlockUpdate(long worldId, long pos, int newStateId, Player viewer,
                               WorldSettings.TunnelShield config) {
        if (!config.enabled() || viewer == null || newStateId != 0) {
            return -1;
        }
        WorldTunnels tunnels = worlds.get(worldId);
        if (tunnels == null) {
            return -1;
        }
        Integer original = tunnels.originalState.get(pos);
        if (original == null) {
            return -1;
        }
        var session = plugin.sessions().get(viewer.getUniqueId());
        if (session == null) {
            return -1;
        }
        int x = BlockPosUtil.decodeX(pos);
        int y = BlockPosUtil.decodeY(pos);
        int z = BlockPosUtil.decodeZ(pos);
        double dx = (x + 0.5) - session.eyeX();
        double dy = (y + 0.5) - session.eyeY();
        double dz = (z + 0.5) - session.eyeZ();
        if (dx * dx + dy * dy + dz * dz <= config.hideRadius() * config.hideRadius()) {
            return -1;
        }
        metrics.recordTunnelBlockMasked();
        return original;
    }

    // ── near reveal / far re-mask ──────────────────────────────────────────

    /** Main thread, budgeted: reveal real air when close, mask again when walking away. */
    public void tick(TimeBudget budget) {
        List<Player> online = new ArrayList<>(plugin.getServer().getOnlinePlayers());
        if (online.isEmpty()) {
            return;
        }
        Player viewer = online.get(viewerCursor++ % online.size());
        if (!viewer.isOnline()) {
            return;
        }
        WorldSettings settings = plugin.config().world(viewer.getWorld().getName());
        WorldSettings.TunnelShield config = settings.tunnelShield();
        if (!config.enabled() || viewer.hasPermission(settings.bypassPermission())) {
            revealedByViewer.remove(viewer.getUniqueId());
            return;
        }
        long worldId = WorldKeys.idOf(viewer.getWorld());
        WorldTunnels tunnels = worlds.get(worldId);
        if (tunnels == null) {
            return;
        }
        Set<Long> revealed = revealedByViewer.computeIfAbsent(viewer.getUniqueId(), id -> ConcurrentHashMap.newKeySet());
        Location eye = viewer.getEyeLocation();
        int radiusChunks = (int) Math.ceil(config.hideRadius() / 16.0) + 1;
        int centerX = viewer.getLocation().getBlockX() >> 4;
        int centerZ = viewer.getLocation().getBlockZ() >> 4;
        double radiusSq = config.hideRadius() * config.hideRadius();
        for (int dx = -radiusChunks; dx <= radiusChunks; dx++) {
            for (int dz = -radiusChunks; dz <= radiusChunks; dz++) {
                long chunkKey = BlockPosUtil.chunkKey(worldId, centerX + dx, centerZ + dz);
                Set<Long> positions = tunnels.byChunk.get(chunkKey);
                if (positions == null) {
                    continue;
                }
                List<Long> snapshot;
                synchronized (positions) {
                    snapshot = new ArrayList<>(positions);
                }
                for (long pos : snapshot) {
                    int x = BlockPosUtil.decodeX(pos);
                    int y = BlockPosUtil.decodeY(pos);
                    int z = BlockPosUtil.decodeZ(pos);
                    boolean near = eye.distanceSquared(
                            new Location(viewer.getWorld(), x + 0.5, y + 0.5, z + 0.5)) <= radiusSq;
                    if (near && !revealed.contains(pos)) {
                        viewer.sendBlockChange(new Location(viewer.getWorld(), x, y, z),
                                Material.AIR.createBlockData());
                        revealed.add(pos);
                    } else if (!near && revealed.contains(pos)) {
                        String originalName = tunnels.originalName.get(pos);
                        if (originalName != null) {
                            viewer.sendBlockChange(new Location(viewer.getWorld(), x, y, z),
                                    blockDataForName(originalName));
                        }
                        revealed.remove(pos);
                    }
                    if (budget.expired()) {
                        return;
                    }
                }
            }
        }
    }

    public void onViewerQuit(UUID viewerId) {
        revealedByViewer.remove(viewerId);
    }

    public void clear() {
        worlds.clear();
        revealedByViewer.clear();
        total.set(0);
    }

    public String diagnostics() {
        return "tracked=" + total.get() + " worlds=" + worlds.size()
                + " revealedSets=" + revealedByViewer.size();
    }

    // ── state helpers ─────────────────────────────────────────────────────

    private int defaultStateId(Material material) {
        try {
            WrappedBlockState state = WrappedBlockState.getByString(
                    protocolVersion, "minecraft:" + material.name().toLowerCase());
            return state == null ? 0 : state.getGlobalId();
        } catch (RuntimeException ex) {
            return 0;
        }
    }

    private static org.bukkit.block.data.BlockData blockDataForName(String materialName) {
        Material material = Material.matchMaterial(materialName);
        if (material == null || !material.isBlock() || material.isAir()) {
            return Material.STONE.createBlockData();
        }
        return material.createBlockData();
    }
}
