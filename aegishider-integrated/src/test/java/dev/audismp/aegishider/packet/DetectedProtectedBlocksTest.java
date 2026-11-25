package dev.audismp.aegishider.packet;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DetectedProtectedBlocksTest {

    @Test
    void addContainsDrainAndClear() {
        DetectedProtectedBlocks bridge = new DetectedProtectedBlocks(16);
        bridge.add(1L, 100L);
        bridge.add(1L, 200L);
        bridge.add(2L, 300L);
        bridge.add(1L, 100L); // duplicate must not double count
        assertTrue(bridge.contains(1L, 100L));
        assertTrue(bridge.contains(2L, 300L));
        assertFalse(bridge.contains(1L, 300L));
        assertEquals(3, bridge.trackedPositions());

        List<Map.Entry<Long, long[]>> drained = bridge.drain();
        assertEquals(2, drained.size());
        assertEquals(0, bridge.trackedPositions());
        assertFalse(bridge.contains(1L, 100L), "drained positions are removed");
        long total = drained.stream().mapToInt(entry -> entry.getValue().length).sum();
        assertEquals(3L, total);
        assertTrue(bridge.drain().isEmpty());
    }

    @Test
    void boundedDrainLeavesRemainderForNextTick() {
        DetectedProtectedBlocks bridge = new DetectedProtectedBlocks(32);
        for (int i = 0; i < 20; i++) {
            bridge.add(1L, i);
        }
        List<Map.Entry<Long, long[]>> first = bridge.drain(8);
        long firstCount = first.stream().mapToInt(entry -> entry.getValue().length).sum();
        assertEquals(8L, firstCount);
        assertEquals(12, bridge.trackedPositions());
        List<Map.Entry<Long, long[]>> second = bridge.drain(8);
        assertEquals(8L, second.stream().mapToInt(entry -> entry.getValue().length).sum());
        assertEquals(4, bridge.trackedPositions());
    }

    @Test
    void overflowIsCountedAndBounded() {
        DetectedProtectedBlocks bridge = new DetectedProtectedBlocks(2);
        bridge.add(1L, 1L);
        bridge.add(1L, 2L);
        bridge.add(1L, 3L); // over the bound
        bridge.add(1L, 4L);
        assertEquals(2, bridge.trackedPositions());
        assertEquals(2L, bridge.overflowCount());
        assertFalse(bridge.contains(1L, 3L));
        assertTrue(bridge.contains(1L, 2L));
    }

    @Test
    void capIsAtLeastOne() {
        DetectedProtectedBlocks bridge = new DetectedProtectedBlocks(0);
        bridge.add(5L, 7L);
        assertEquals(1, bridge.trackedPositions());
        assertTrue(bridge.contains(5L, 7L));
    }
}
