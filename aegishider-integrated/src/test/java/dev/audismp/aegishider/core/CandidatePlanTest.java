package dev.audismp.aegishider.core;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CandidatePlanTest {

    @Test
    void everyChunkGetsAFairQuotaUnderTheCap() {
        List<CandidatePlan.Chunk> chunks = new ArrayList<>();
        for (int chunk = 0; chunk < 5; chunk++) {
            chunks.add(new CandidatePlan.Chunk(chunk, 0, positions(chunk * 100L, 10)));
        }

        long[] selected = CandidatePlan.select(chunks, 0, 0, 20);

        assertEquals(20, selected.length);
        for (int chunk = 0; chunk < 5; chunk++) {
            long from = chunk * 100L;
            long to = from + 10;
            long count = java.util.Arrays.stream(selected)
                    .filter(pos -> pos >= from && pos < to)
                    .count();
            assertEquals(4, count, "every chunk must receive its quota: chunk " + chunk);
        }
    }

    @Test
    void tightBudgetStillGivesEachChunkOnePositionNearestFirst() {
        List<CandidatePlan.Chunk> chunks = List.of(
                new CandidatePlan.Chunk(5, 5, new long[]{50, 51}),
                new CandidatePlan.Chunk(0, 0, new long[]{10, 11}));

        long[] selected = CandidatePlan.select(chunks, 0, 0, 2);

        assertEquals(2, selected.length);
        assertEquals(10, selected[0], "the nearest chunk is served first");
        assertEquals(50, selected[1], "but the far chunk is not starved");
    }

    @Test
    void largeBaseNeverLosesAChunkToTheTwoThousandFortyEightCap() {
        List<CandidatePlan.Chunk> chunks = new ArrayList<>();
        for (int chunk = 0; chunk < 25; chunk++) {
            chunks.add(new CandidatePlan.Chunk(chunk, 0, positions(chunk * 1000L, 100)));
        }

        long[] selected = CandidatePlan.select(chunks, 0, 0, 2048);

        assertEquals(2048, selected.length);
        for (int chunk = 0; chunk < 25; chunk++) {
            long from = chunk * 1000L;
            long to = from + 100;
            assertTrue(java.util.Arrays.stream(selected).anyMatch(pos -> pos >= from && pos < to),
                    "chunk " + chunk + " was starved by the candidate cap");
        }
    }

    private static long[] positions(long start, int count) {
        long[] positions = new long[count];
        for (int i = 0; i < count; i++) {
            positions[i] = start + i;
        }
        return positions;
    }
}
