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
        return drain(Integer.MAX_VALUE);
    }

    /**
     * Main thread: removes at most {@code maxPositions} entries so a large stream of
     * state-scan detections cannot monopolise one tick. Remaining entries stay in the
     * fail-closed bridge and are picked up next tick.
     */
    public List<Map.Entry<Long, long[]>> drain(int maxPositions) {
        int remaining = Math.max(1, maxPositions);
        List<Map.Entry<Long, long[]>> drained = new ArrayList<>(byWorld.size());
        for (Long worldId : new ArrayList<>(byWorld.keySet())) {
            if (remaining <= 0) {
                break;
            }
            LongOpenHashSet set = byWorld.get(worldId);
            if (set == null) {
                continue;
            }
            long[] positions;
            synchronized (set) {
                int take = Math.min(remaining, set.size());
                positions = new long[take];
                var iterator = set.iterator();
                int index = 0;
                while (index < take && iterator.hasNext()) {
                    positions[index++] = iterator.nextLong();
                    iterator.remove();
                }
                size.addAndGet(-take);
                if (set.isEmpty()) {
                    byWorld.remove(worldId, set);
                }
            }
            if (positions.length > 0) {
                drained.add(Map.entry(worldId, positions));
                remaining -= positions.length;
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
