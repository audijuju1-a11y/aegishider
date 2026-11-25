package dev.audismp.aegishider.core;

import it.unimi.dsi.fastutil.longs.LongArrayList;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * Fair candidate selection for the block reveal engine.
 *
 * <p>The old code stopped adding chunks when a global 2,048-position cap was
 * reached, in a fixed north-west to south-east order. A large base therefore
 * starved the same chunks on every scan and their containers never became
 * visible to their owner. This planner gives every chunk a fair first quota,
 * ordered nearest-first, then redistributes the remaining budget.
 */
public final class CandidatePlan {

    public record Chunk(int chunkX, int chunkZ, long[] positions) {
        public Chunk {
            positions = positions == null ? new long[0] : positions;
        }
    }

    private CandidatePlan() {
    }

    /**
     * Selects at most {@code maxPositions} encoded block positions.
     *
     * <p>Every supplied chunk gets up to {@code maxPositions / chunkCount} positions in
     * the first pass, so a single dense chunk can no longer consume the whole budget.
     * The second pass spends the remaining budget nearest-first.
     */
    public static long[] select(List<Chunk> chunks, int centerChunkX, int centerChunkZ,
                                int maxPositions) {
        if (chunks == null || chunks.isEmpty() || maxPositions <= 0) {
            return new long[0];
        }
        List<Chunk> ordered = new ArrayList<>(chunks);
        ordered.sort(Comparator
                .comparingLong((Chunk chunk) -> distanceSq(chunk, centerChunkX, centerChunkZ))
                .thenComparingInt(Chunk::chunkX)
                .thenComparingInt(Chunk::chunkZ));

        int count = ordered.size();
        int quota = Math.max(1, maxPositions / count);
        int[] taken = new int[count];
        LongArrayList selected = new LongArrayList(Math.min(maxPositions, 4096));

        for (int i = 0; i < count && selected.size() < maxPositions; i++) {
            Chunk chunk = ordered.get(i);
            int take = Math.min(quota, chunk.positions().length);
            for (int p = 0; p < take && selected.size() < maxPositions; p++) {
                selected.add(chunk.positions()[p]);
            }
            taken[i] = take;
        }

        while (selected.size() < maxPositions) {
            boolean progress = false;
            for (int i = 0; i < count && selected.size() < maxPositions; i++) {
                Chunk chunk = ordered.get(i);
                if (taken[i] < chunk.positions().length) {
                    selected.add(chunk.positions()[taken[i]++]);
                    progress = true;
                }
            }
            if (!progress) {
                break;
            }
        }
        return selected.toLongArray();
    }

    private static long distanceSq(Chunk chunk, int centerChunkX, int centerChunkZ) {
        long dx = chunk.chunkX() - centerChunkX;
        long dz = chunk.chunkZ() - centerChunkZ;
        return dx * dx + dz * dz;
    }
}
