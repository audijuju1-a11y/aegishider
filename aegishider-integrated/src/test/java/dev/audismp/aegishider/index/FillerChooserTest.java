package dev.audismp.aegishider.index;

import org.bukkit.Material;
import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;

class FillerChooserTest {

    private static final Set<Material> HIDDEN = Set.of(Material.CHEST, Material.BARREL,
            Material.TRAPPED_CHEST);

    @Test
    void surfaceChestUsesGroundMaterial() {
        Material result = FillerChooser.chooseFrom(Material.AIR, Material.GRASS_BLOCK,
                new Material[]{Material.AIR, Material.AIR, Material.AIR, Material.AIR},
                HIDDEN, Material.STONE);
        assertEquals(Material.GRASS_BLOCK, result);
    }

    @Test
    void undergroundChestUsesStoneNeighbours() {
        Material result = FillerChooser.chooseFrom(Material.STONE, Material.STONE,
                new Material[]{Material.STONE, Material.STONE, Material.STONE, Material.AIR},
                HIDDEN, Material.STONE);
        assertEquals(Material.STONE, result);
    }

    @Test
    void wallChestUsesDominantWallMaterial() {
        Material result = FillerChooser.chooseFrom(Material.OAK_PLANKS, Material.OAK_PLANKS,
                new Material[]{Material.OAK_PLANKS, Material.OAK_PLANKS,
                        Material.STONE, Material.AIR},
                HIDDEN, Material.STONE);
        assertEquals(Material.OAK_PLANKS, result);
    }

    @Test
    void hiddenMaterialIsNeverChosenAsFiller() {
        // Chest below/next to chest must not be used as filler; fallback is used instead.
        Material result = FillerChooser.chooseFrom(Material.CHEST, Material.CHEST,
                new Material[]{Material.CHEST, Material.AIR, Material.AIR, Material.AIR},
                HIDDEN, Material.STONE);
        assertEquals(Material.STONE, result);
    }

    @Test
    void fallbackUsedWhenNothingUsable() {
        Material result = FillerChooser.chooseFrom(Material.AIR, Material.WATER,
                new Material[]{Material.AIR, Material.AIR, Material.WATER, Material.AIR},
                HIDDEN, Material.DIRT);
        assertEquals(Material.DIRT, result);
    }

    @Test
    void nonHiddenTileEntityMaterialIsNeverChosenAsFiller() {
        // A sign/banner has a block entity even though it is not in hidden-blocks:
        // faking a chest with a sign makes the client register a phantom block entity,
        // which is exactly the leak class this plugin exists to close.
        Material result = FillerChooser.chooseFrom(Material.OAK_SIGN, Material.OAK_SIGN,
                new Material[]{Material.OAK_SIGN, Material.OAK_SIGN,
                        Material.STONE, Material.AIR},
                HIDDEN, Material.STONE);
        assertEquals(Material.STONE, result, "sign neighbours must be skipped, stone wins");
    }

    @Test
    void tileEntityFallbackDegradesToStone() {
        Material result = FillerChooser.chooseFrom(Material.AIR, Material.WATER,
                new Material[]{Material.AIR, Material.AIR, Material.WATER, Material.AIR},
                HIDDEN, Material.CHEST);
        assertEquals(Material.STONE, result, "a configured TE fallback must degrade to stone");
    }
}
