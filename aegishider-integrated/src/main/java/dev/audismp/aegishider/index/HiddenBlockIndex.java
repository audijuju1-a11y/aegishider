package dev.audismp.aegishider.index;

import dev.audismp.aegishider.metrics.Metrics;
import dev.audismp.aegishider.util.BlockPosUtil;
import it.unimi.dsi.fastutil.longs.LongOpenHashSet;
import org.bukkit.Material;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Single source of truth for "this block position is protected in this world".
 *
 * <p>Threading model:
 * <ul>
 *   <li>All writes happen on the main thread (block events, discovery, reconciliation).</li>
 *   <li>Reads happen on the main thread (reveal engine) and on the packet thread
 *       (chunk/block packet filtering). Readers are lock free.</li>
 *   <li>A chunk's positions are stored as a sorted {@code long[]} inside an immutable
 *       {@link ChunkView}. Mutations replace the view in the concurrent map (copy on
 *       write, per chunk). Hidden block counts per chunk are small (tens), so the
 *       copy cost is negligible compared to a lock in the packet path.</li>
 * </ul>
 *
 * <p>The index is world-state derived: it is rebuilt from real chunk data on load and
 * maintained by events, so it survives chunk unloads/restarts without a persistence
 * file. No eviction happens on chunk unload - blocks still exist in the world.
 */
public final class HiddenBlockIndex {

    private final Metrics metrics;
    private final ConcurrentHashMap<Long, WorldIndex> worlds = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<Long, ConcurrentHashMap<Long, Tombstone>> tombstones = new ConcurrentHashMap<>();
    private static final long TOMBSTONE_TTL_MS = 15_000L;

    private record Tombstone(Material material, long expiresAt) {
    }
    /** Per-world per-position client filler material (contextual filler mode). */
    private final ConcurrentHashMap<Long, ConcurrentHashMap<Long, Material>> fillers = new ConcurrentHashMap<>();
    private final AtomicLong revision = new AtomicLong();

    public HiddenBlockIndex(Metrics metrics) {
        this.metrics = metrics;
    }

    private static final class WorldIndex {
        final ConcurrentHashMap<Long, ChunkView> chunks = new ConcurrentHashMap<>();
        final AtomicInteger blockCount = new AtomicInteger();
        final AtomicInteger chunkCount = new AtomicInteger();
    }

    /** Immutable view of the protected blocks inside one chunk. */
    public static final class ChunkView {
        private final long chunkKey;
        private final int chunkX;
        private final int chunkZ;
        private final long[] positions;
        private final long revision;

        private ChunkView(long chunkKey, long[] positions, long revision) {
            this.chunkKey = chunkKey;
            this.chunkX = BlockPosUtil.chunkXOf(chunkKey);
            this.chunkZ = BlockPosUtil.chunkZOf(chunkKey);
            this.positions = positions;
            this.revision = revision;
        }

        public long chunkKey() { return chunkKey; }
        public int chunkX() { return chunkX; }
        public int chunkZ() { return chunkZ; }
        /** Sorted encoded block positions. Do not modify. */
        public long[] positions() { return positions; }
        public int size() { return positions.length; }
        public long revision() { return revision; }

        public boolean contains(long blockPos) {
            return Arrays.binarySearch(positions, blockPos) >= 0;
        }
    }

    // ── Main-thread writes ─────────────────────────────────────────────────

    /** Registers a single protected block. Returns true when the view changed. */
    public boolean register(long worldId, long blockPos) {
        if (worldId == 0L) {
            return false;
        }
        long chunkKey = BlockPosUtil.chunkKeyOfBlock(worldId, blockPos);
        WorldIndex world = worlds.computeIfAbsent(worldId, id -> new WorldIndex());
        ChunkView existing = world.chunks.get(chunkKey);
        if (existing != null && existing.contains(blockPos)) {
            return false;
        }
        long[] previous = existing == null ? new long[0] : existing.positions();
        long[] next = insertSorted(previous, blockPos);
        world.chunks.put(chunkKey, new ChunkView(chunkKey, next, revision.incrementAndGet()));
        if (existing == null) {
            world.chunkCount.incrementAndGet();
            if (metrics != null) {
                metrics.recordChunkFlagged();
            }
        }
        world.blockCount.incrementAndGet();
        if (metrics != null) {
            metrics.recordHiddenBlockRegistered();
        }
        return true;
    }

    /** Stores the client-side filler material chosen for one protected block. */
    public void setFiller(long worldId, long blockPos, Material material) {
        if (worldId == 0L || material == null) {
            return;
        }
        fillers.computeIfAbsent(worldId, id -> new ConcurrentHashMap<>()).put(blockPos, material);
    }

    /** Filler to use when a recently removed protected position is sent as air, or null. */
    public Material tombstoneFiller(long worldId, long blockPos) {
        ConcurrentHashMap<Long, Tombstone> worldTombstones = tombstones.get(worldId);
        if (worldTombstones == null) {
            return null;
        }
        Tombstone tombstone = worldTombstones.get(blockPos);
        if (tombstone == null) {
            return null;
        }
        if (tombstone.expiresAt() < System.currentTimeMillis()) {
            worldTombstones.remove(blockPos);
            return null;
        }
        return tombstone.material();
    }

    /** Drops expired tombstones; called from the main-thread maintenance tick. */
    public void pruneTombstones(long now) {
        tombstones.values().forEach(map -> map.entrySet().removeIf(entry -> entry.getValue().expiresAt() < now));
    }

    /** Client-side filler for a protected block, or {@code fallback} when not chosen yet. */
    public Material filler(long worldId, long blockPos, Material fallback) {
        ConcurrentHashMap<Long, Material> worldFillers = fillers.get(worldId);
        if (worldFillers == null) {
            return fallback;
        }
        Material material = worldFillers.get(blockPos);
        return material == null ? fallback : material;
    }

    /** Unregisters a single protected block. Returns true when the view changed. */
    public boolean unregister(long worldId, long blockPos) {
        WorldIndex world = worlds.get(worldId);
        if (world == null) {
            return false;
        }
        long chunkKey = BlockPosUtil.chunkKeyOfBlock(worldId, blockPos);
        ChunkView existing = world.chunks.get(chunkKey);
        if (existing == null || !existing.contains(blockPos)) {
            return false;
        }
        // Remember the last filler so a break/explosion cannot reveal the position as air.
        ConcurrentHashMap<Long, Material> worldFillers = fillers.get(worldId);
        Material filler = worldFillers == null ? null : worldFillers.get(blockPos);
        tombstones.computeIfAbsent(worldId, id -> new ConcurrentHashMap<>())
                .put(blockPos, new Tombstone(filler == null ? Material.STONE : filler,
                        System.currentTimeMillis() + TOMBSTONE_TTL_MS));
        if (worldFillers != null) {
            worldFillers.remove(blockPos);
        }
        long[] previous = existing.positions();
        long[] next = removeSorted(previous, blockPos);
        long newRevision = revision.incrementAndGet();
        if (next.length == 0) {
            world.chunks.remove(chunkKey);
            world.chunkCount.decrementAndGet();
        } else {
            world.chunks.put(chunkKey, new ChunkView(chunkKey, next, newRevision));
        }
        world.blockCount.decrementAndGet();
        if (metrics != null) {
            metrics.recordHiddenBlockRemoved();
        }
        return true;
    }

    /** Unregisters several blocks at once (explosions, pistons, chunk re-discovery). */
    public int unregisterAll(long worldId, long[] blockPositions) {
        int removed = 0;
        for (long pos : blockPositions) {
            if (unregister(worldId, pos)) {
                removed++;
            }
        }
        return removed;
    }

    /**
     * Replaces the complete protected block set of one chunk with {@code discovered}.
     * Used by discovery/reconciliation so stale entries are removed atomically per chunk.
     *
     * @param discovered encoded positions found in the world right now (may be empty)
     * @return number of block entries that changed (added + removed)
     */
    public int replaceChunk(long worldId, int chunkX, int chunkZ, LongOpenHashSet discovered) {
        if (worldId == 0L) {
            return 0;
        }
        long chunkKey = BlockPosUtil.chunkKey(worldId, chunkX, chunkZ);
        WorldIndex world = worlds.computeIfAbsent(worldId, id -> new WorldIndex());
        ChunkView existing = world.chunks.get(chunkKey);
        long[] previous = existing == null ? new long[0] : existing.positions();

        long[] next;
        if (discovered == null || discovered.isEmpty()) {
            next = new long[0];
        } else {
            next = discovered.toLongArray();
            Arrays.sort(next);
        }
        if (Arrays.equals(previous, next)) {
            return 0;
        }

        int added = 0;
        int removed = 0;
        int i = 0;
        int j = 0;
        while (i < previous.length || j < next.length) {
            if (j >= next.length) {
                removed++;
                i++;
            } else if (i >= previous.length) {
                added++;
                j++;
            } else if (previous[i] == next[j]) {
                i++;
                j++;
            } else if (previous[i] < next[j]) {
                removed++;
                i++;
            } else {
                added++;
                j++;
            }
        }

        long newRevision = revision.incrementAndGet();
        if (next.length == 0) {
            world.chunks.remove(chunkKey);
            if (existing != null) {
                world.chunkCount.decrementAndGet();
            }
        } else {
            world.chunks.put(chunkKey, new ChunkView(chunkKey, next, newRevision));
            if (existing == null) {
                world.chunkCount.incrementAndGet();
                if (metrics != null) {
                    metrics.recordChunkFlagged();
                }
            }
        }
        world.blockCount.addAndGet(added - removed);
        if (metrics != null) {
            for (int k = 0; k < added; k++) {
                metrics.recordHiddenBlockRegistered();
            }
            for (int k = 0; k < removed; k++) {
                metrics.recordHiddenBlockRemoved();
            }
        }
        return added + removed;
    }

    /** Removes all data for a world (world unload / plugin disable). */
    public void evictWorld(long worldId) {
        fillers.remove(worldId);
        tombstones.remove(worldId);
        worlds.remove(worldId);
        revision.incrementAndGet();
    }

    public void clear() {
        fillers.clear();
        worlds.clear();
        tombstones.clear();
        revision.incrementAndGet();
    }

    // ── Lock-free reads ────────────────────────────────────────────────────

    /** Returns null when the chunk has no protected blocks. Safe from any thread. */
    public ChunkView chunkView(long worldId, int chunkX, int chunkZ) {
        WorldIndex world = worlds.get(worldId);
        if (world == null) {
            return null;
        }
        return world.chunks.get(BlockPosUtil.chunkKey(worldId, chunkX, chunkZ));
    }

    /** Returns the chunk view for an absolute block position, or null. */
    public ChunkView chunkViewOfBlock(long worldId, long blockPos) {
        return chunkView(worldId, BlockPosUtil.decodeX(blockPos) >> 4, BlockPosUtil.decodeZ(blockPos) >> 4);
    }

    /** O(log n) check whether one block position is protected. Safe from any thread. */
    public boolean isHidden(long worldId, long blockPos) {
        ChunkView view = chunkViewOfBlock(worldId, blockPos);
        return view != null && view.contains(blockPos);
    }

    public boolean isHidden(long worldId, int x, int y, int z) {
        return isHidden(worldId, BlockPosUtil.encode(x, y, z));
    }

    public long revision() {
        return revision.get();
    }

    public int worldBlockCount(long worldId) {
        WorldIndex world = worlds.get(worldId);
        return world == null ? 0 : world.blockCount.get();
    }

    public int worldChunkCount(long worldId) {
        WorldIndex world = worlds.get(worldId);
        return world == null ? 0 : world.chunkCount.get();
    }

    public int totalBlockCount() {
        int total = 0;
        for (WorldIndex world : worlds.values()) {
            total += world.blockCount.get();
        }
        return total;
    }

    public int totalChunkCount() {
        int total = 0;
        for (WorldIndex world : worlds.values()) {
            total += world.chunkCount.get();
        }
        return total;
    }

    /**
     * Returns every protected block position across all worlds. Used by /aegishider reload
     * to restore real blocks when protection is disabled. Not a hot path.
     */
    public long[] snapshotAllPositions() {
        long[] result = new long[16];
        int size = 0;
        for (long[] positions : snapshotByWorld().values()) {
            if (size + positions.length > result.length) {
                result = Arrays.copyOf(result, Math.max(result.length * 2, size + positions.length));
            }
            System.arraycopy(positions, 0, result, size, positions.length);
            size += positions.length;
        }
        return Arrays.copyOf(result, size);
    }

    /**
     * Same data as {@link #snapshotAllPositions()} but keyed by world id, so callers never
     * apply one world's positions to a player standing in another world.
     */
    public Map<Long, long[]> snapshotByWorld() {
        Map<Long, long[]> result = new LinkedHashMap<>();
        for (Map.Entry<Long, WorldIndex> entry : worlds.entrySet()) {
            WorldIndex world = entry.getValue();
            long[] positions = new long[Math.max(16, world.blockCount.get())];
            int size = 0;
            for (ChunkView view : world.chunks.values()) {
                long[] chunkPositions = view.positions();
                if (size + chunkPositions.length > positions.length) {
                    positions = Arrays.copyOf(positions,
                            Math.max(positions.length * 2, size + chunkPositions.length));
                }
                System.arraycopy(chunkPositions, 0, positions, size, chunkPositions.length);
                size += chunkPositions.length;
            }
            result.put(entry.getKey(), Arrays.copyOf(positions, size));
        }
        return result;
    }

    /** Diagnostic: number of tracked worlds. */
    public int worldCount() {
        return worlds.size();
    }

    // ── Sorted array helpers (small arrays) ────────────────────────────────

    static long[] insertSorted(long[] values, long value) {
        int index = Arrays.binarySearch(values, value);
        if (index >= 0) {
            return values;
        }
        int insertion = -index - 1;
        long[] result = new long[values.length + 1];
        System.arraycopy(values, 0, result, 0, insertion);
        result[insertion] = value;
        System.arraycopy(values, insertion, result, insertion + 1, values.length - insertion);
        return result;
    }

    static long[] removeSorted(long[] values, long value) {
        int index = Arrays.binarySearch(values, value);
        if (index < 0) {
            return values;
        }
        long[] result = new long[values.length - 1];
        System.arraycopy(values, 0, result, 0, index);
        System.arraycopy(values, index + 1, result, index, values.length - index - 1);
        return result;
    }
}
