package dev.audismp.aegishider.config;

import org.bukkit.Material;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class YShieldFairnessTest {

    private static final WorldSettings.YShield SHIELD =
            new WorldSettings.YShield(true, 40, 0, Material.STONE);

    @Test
    void airIsNeverRewrittenToFiller() {
        // A block update with state id 0 is air: the client must see the removal or the
        // broken block comes back as a ghost block.
        assertFalse(SHIELD.masksBlockUpdate(100.0, 10, 0));
        assertTrue(SHIELD.masksBlockUpdate(100.0, 10, 1));
    }

    @Test
    void sameFloorEntitiesStayVisibleAcrossTheDeadBand() {
        assertFalse(SHIELD.masksEntity(42.0, 39.0),
                "eye 42.0 vs entity 39.0 is a 3-block gap: same floor, must stay visible");
        assertTrue(SHIELD.masksEntity(45.0, 39.0),
                "a real floor separation still hides the entity");
        assertFalse(SHIELD.masksEntity(45.0, 41.0),
                "above the line is never masked");
        assertFalse(SHIELD.masksEntity(41.0, 39.0),
                "a viewer below the 2-block margin sees the real world");
    }
}
