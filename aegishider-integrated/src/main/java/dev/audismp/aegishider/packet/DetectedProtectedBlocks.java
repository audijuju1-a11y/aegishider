package dev.audismp.aegishider.packet;

import it.unimi.dsi.fastutil.longs.LongOpenHashSet;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Fail-closed bridge for protected block positions that the packet layer discovered on a
 * chunk packet but that are not (yet) in the main-thread index.
 *
 * <p>Chunk packets are sanitized by scanning the parsed chunk's block-entity list, not only
 * the index. That closes the "block changed by a non-Bukkit path and the index has not been
 * reconciled yet" leak, including the first chunk send after a player enters the area.
 * Positions detected this way are kept here so block update packets for them can already be
 * filtered on the Netty thread; the main thread drains this structure every tick, registers
 * the positions in {@code HiddenBlockIndex} and schedules a chunk discovery to reconcile.
 *
 * <p>Memory is bounded: at most {@link #MAX_POSITIONS} entries are tracked. Overflow is
 * counted (not silently ignored); initial chunk data is still sanitized because it does not
 * depend on this bridge.
 */
public final class DetectedProtectedBlocks {

    private static final int DEFAULT_MAX_POSITIONS = 16_384;
    private final int maxPositions;

    private final ConcurrentHashMap<Long, LongOpenHashSet> byWorld = new ConcurrentHashMap<>();
    private final AtomicInteger size = new AtomicInteger();
    private final AtomicInteger overflow = new AtomicInteger();

    public DetectedProtectedBlocks() {
        this(DEFAULT_MAX_POSITIONS);
    }

    /** Test/diagnostic constructor with an explicit bound. */
    public DetectedProtectedBlocks(int maxPositions) {
        this.maxPositions = Math.max(1, maxPositions);
    }

    /** Called from the Netty thread. */
    public void add(long worldId, long blockPos) {
        LongOpenHashSet set = byWorld.computeIfAbsent(worldId, key -> new LongOpenHashSet(16));
        synchronized (set) {
            if (set.contains(blockPos)) {
                return;
            }
            if (size.get() >= maxPositions) {
                overflow.incrementAndGet();
                return;
            }
            set.add(blockPos);
            size.incrementAndGet();
        }
    }

    /** Called from the Netty thread for block update filtering. */
    public boolean contains(long worldId, long blockPos) {
        LongOpenHashSet set = byWorld.get(worldId);
        if (set == null) {
            return false;
        }
        synchronized (set) {
            return set.contains(blockPos);
        }
    }

    /** Main thread: removes and returns all detected positions grouped by world id. */
    public List<Map.Entry<Long, long[]>> drain() {
        List<Map.Entry<Long, long[]>> drained = new ArrayList<>(byWorld.size());
        for (Long worldId : new ArrayList<>(byWorld.keySet())) {
            LongOpenHashSet set = byWorld.remove(worldId);
            if (set == null) {
                continue;
            }
            long[] positions;
            synchronized (set) {
                size.addAndGet(-set.size());
                positions = set.toLongArray();
            }
            if (positions.length > 0) {
                drained.add(Map.entry(worldId, positions));
            }
        }
        return drained;
    }

    public int trackedPositions() {
        return Math.max(0, size.get());
    }

    public long overflowCount() {
        return overflow.get();
    }
}
