package dev.audismp.aegishider.core;

import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ChunkRefreshPlanTest {

    @Test
    void playerChunkIsFirstAndOrderExpandsOutward() {
        List<ChunkRefreshPlan.Step> steps = ChunkRefreshPlan.centerOut(10, -4, 2);

        assertEquals(25, steps.size());
        assertEquals(10, steps.get(0).chunkX());
        assertEquals(-4, steps.get(0).chunkZ());
        assertEquals(0, steps.get(0).distanceSq());

        int previous = -1;
        Set<Long> seen = new HashSet<>();
        for (ChunkRefreshPlan.Step step : steps) {
            assertTrue(step.distanceSq() >= previous, "order must be nearest-first");
            previous = step.distanceSq();
            long key = (((long) step.chunkX()) << 32) ^ (step.chunkZ() & 0xFFFFFFFFL);
            assertTrue(seen.add(key), "a chunk must appear only once");
        }
    }

    @Test
    void radiusZeroStillRefreshesThePlayerChunk() {
        List<ChunkRefreshPlan.Step> steps = ChunkRefreshPlan.centerOut(3, 7, 0);
        assertEquals(1, steps.size());
        assertEquals(3, steps.get(0).chunkX());
        assertEquals(7, steps.get(0).chunkZ());
    }
}
