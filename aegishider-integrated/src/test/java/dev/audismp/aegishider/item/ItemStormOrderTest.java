package dev.audismp.aegishider.item;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;

class ItemStormOrderTest {

    @Test
    void ownerVisibleItemsComeFirst() {
        boolean[] owner = {false, true, false};
        double[] distance = {1.0, 1000.0, 2.0};
        assertArrayEquals(new int[]{1, 0, 2}, ItemStormOrder.order(owner, distance));
    }

    @Test
    void nearestItemsComeFirstWithinTheSameOwnerClass() {
        boolean[] owner = {false, false, false, false};
        double[] distance = {25.0, 1.0, 9.0, 4.0};
        assertArrayEquals(new int[]{1, 3, 2, 0}, ItemStormOrder.order(owner, distance));
    }

    @Test
    void ownerClassWinsOverDistance() {
        boolean[] owner = {false, true};
        double[] distance = {0.5, 100.0};
        assertArrayEquals(new int[]{1, 0}, ItemStormOrder.order(owner, distance));
    }

    @Test
    void handlesEmptyAndSingleItemBatches() {
        assertArrayEquals(new int[0], ItemStormOrder.order(new boolean[0], new double[0]));
        assertArrayEquals(new int[]{0}, ItemStormOrder.order(new boolean[]{true}, new double[]{4.0}));
    }
}
