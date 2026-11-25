package dev.audismp.aegishider.core;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * Computes a center-out chunk order for Y-shield refreshes.
 *
 * <p>The previous queue walked the view square from its north-west corner, so the
 * chunk under the player was refreshed roughly halfway through the queue. With four
 * chunks per tick that left the player's feet showing stale filler for several
 * seconds. Starting at the player's chunk removes that collision-desync window.
 */
public final class ChunkRefreshPlan {

    public record Step(int chunkX, int chunkZ, int distanceSq) {
    }

    private ChunkRefreshPlan() {
    }

    /** Returns every chunk in the square, nearest first (the player's chunk is first). */
    public static List<Step> centerOut(int centerChunkX, int centerChunkZ, int radius) {
        int safeRadius = Math.max(0, radius);
        int width = safeRadius * 2 + 1;
        List<Step> steps = new ArrayList<>(width * width);
        for (int dx = -safeRadius; dx <= safeRadius; dx++) {
            for (int dz = -safeRadius; dz <= safeRadius; dz++) {
                steps.add(new Step(centerChunkX + dx, centerChunkZ + dz, dx * dx + dz * dz));
            }
        }
        steps.sort(Comparator
                .comparingInt(Step::distanceSq)
                .thenComparingInt(Step::chunkX)
                .thenComparingInt(Step::chunkZ));
        return steps;
    }
}
