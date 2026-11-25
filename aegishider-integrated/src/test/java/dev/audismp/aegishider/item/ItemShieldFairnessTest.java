package dev.audismp.aegishider.item;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ItemShieldFairnessTest {

    @Test
    void interactionRangeKeepsNearbyMobsClickable() {
        assertTrue(ItemShield.withinInteractionRange(0.0));
        assertTrue(ItemShield.withinInteractionRange(9.0),
                "exactly 3 blocks is vanilla interaction/attack range");
        assertFalse(ItemShield.withinInteractionRange(9.0001));
    }
}
