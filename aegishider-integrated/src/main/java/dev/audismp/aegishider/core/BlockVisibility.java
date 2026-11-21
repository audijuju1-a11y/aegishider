package dev.audismp.aegishider.core;

import dev.audismp.aegishider.util.BlockPosUtil;
import it.unimi.dsi.fastutil.longs.LongOpenHashSet;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * Visibility state for protected blocks that is shared between the main thread
 * (reveal/re-hide decisions) and the packet thread (chunk/block packet filtering).
 *
 * <p>The default is HIDDEN: absence of a "revealed" marker means hidden. This is the
 * fail-closed direction and it is the only state the packet filters rely on.
 *
 * <p>Thread safety:
 * <ul>
 *   <li>per-viewer {@link ViewerBlocks} guards its primitive set with the monitor on
 *       itself (writes are rare: only transitions of nearby protected blocks);</li>
 *   <li>Netty performs O(1) primitive lookups under the same monitor;</li>
 *   <li>chunk resync requests from Netty are queued lock-free and drained by the main
 *       thread, which then drops reveal markers for that chunk and re-evaluates.</li>
 * </ul>
 */
public final class BlockVisibility {

    /** A block resend means the client no longer has our fakes; re-evaluate. */
    public record ResyncRequest(UUID viewer, long chunkKey) {
    }

    private final ConcurrentHashMap<UUID, ViewerBlocks> viewers = new ConcurrentHashMap<>();
    private final ConcurrentLinkedQueue<ResyncRequest> resyncQueue = new ConcurrentLinkedQueue<>();

    private static final class ViewerBlocks {
        final LongOpenHashSet revealed = new LongOpenHashSet();
    }

    public void addViewer(UUID viewer) {
        viewers.computeIfAbsent(viewer, k -> new ViewerBlocks());
    }

    public void removeViewer(UUID viewer) {
        viewers.remove(viewer);
        resyncQueue.removeIf(request -> request.viewer().equals(viewer));
    }

    public boolean isRevealed(UUID viewer, long blockPos) {
        ViewerBlocks blocks = viewers.get(viewer);
        if (blocks == null) {
            return false;
        }
        synchronized (blocks) {
            return blocks.revealed.contains(blockPos);
        }
    }

    /** Marks a protected block as currently shown to the viewer. */
    public boolean markRevealed(UUID viewer, long blockPos) {
        ViewerBlocks blocks = viewers.computeIfAbsent(viewer, k -> new ViewerBlocks());
        synchronized (blocks) {
            return blocks.revealed.add(blockPos);
        }
    }

    /** Marks a protected block as hidden again. */
    public boolean markHidden(UUID viewer, long blockPos) {
        ViewerBlocks blocks = viewers.get(viewer);
        if (blocks == null) {
            return false;
        }
        synchronized (blocks) {
            return blocks.revealed.remove(blockPos);
        }
    }

    /**
     * Drops all reveal markers for a chunk. Called when the client receives a fresh
     * (sanitized) copy of the chunk: the fake blocks are gone client-side.
     *
     * @return number of markers removed
     */
    public int clearChunk(UUID viewer, long chunkKey) {
        ViewerBlocks blocks = viewers.get(viewer);
        if (blocks == null) {
            return 0;
        }
        int chunkX = BlockPosUtil.chunkXOf(chunkKey);
        int chunkZ = BlockPosUtil.chunkZOf(chunkKey);
        int removed = 0;
        synchronized (blocks) {
            var iterator = blocks.revealed.iterator();
            while (iterator.hasNext()) {
                long pos = iterator.nextLong();
                if ((BlockPosUtil.decodeX(pos) >> 4) == chunkX
                        && (BlockPosUtil.decodeZ(pos) >> 4) == chunkZ) {
                    iterator.remove();
                    removed++;
                }
            }
        }
        return removed;
    }

    public int clearAll(UUID viewer) {
        ViewerBlocks blocks = viewers.get(viewer);
        if (blocks == null) {
            return 0;
        }
        synchronized (blocks) {
            int size = blocks.revealed.size();
            blocks.revealed.clear();
            return size;
        }
    }

    public int revealedCount(UUID viewer) {
        ViewerBlocks blocks = viewers.get(viewer);
        if (blocks == null) {
            return 0;
        }
        synchronized (blocks) {
            return blocks.revealed.size();
        }
    }

    public int totalRevealedMarkers() {
        int total = 0;
        for (ViewerBlocks blocks : viewers.values()) {
            synchronized (blocks) {
                total += blocks.revealed.size();
            }
        }
        return total;
    }

    /** Called by the packet thread after it sanitized a chunk for this viewer. */
    public void enqueueResync(UUID viewer, long chunkKey) {
        // Drop markers for this chunk immediately (fail-closed): if any block packet
        // races the main-thread resync it must be treated as hidden.
        clearChunk(viewer, chunkKey);
        resyncQueue.add(new ResyncRequest(viewer, chunkKey));
    }

    /** Drains up to {@code max} resync requests. Main thread only. */
    public List<ResyncRequest> drainResync(int max) {
        List<ResyncRequest> drained = new ArrayList<>(Math.min(max, 64));
        ResyncRequest request;
        while (drained.size() < max && (request = resyncQueue.poll()) != null) {
            drained.add(request);
        }
        return drained;
    }

    public int pendingResyncCount() {
        return resyncQueue.size();
    }

    /**
     * Returns all revealed positions for a viewer as a primitive array.
     * Used by diagnostics/tests; allocates, not a hot path.
     */
    public long[] revealedSnapshot(UUID viewer) {
        ViewerBlocks blocks = viewers.get(viewer);
        if (blocks == null) {
            return new long[0];
        }
        synchronized (blocks) {
            return blocks.revealed.toLongArray();
        }
    }
}
