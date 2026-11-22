package dev.audismp.aegishider.util;

import org.bukkit.Material;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MaterialSetsTest {

    @Test
    void storageBlocksAreDiscoverable() {
        assertTrue(MaterialSets.isDiscoverableBlockEntityMaterial(Material.CHEST));
        assertTrue(MaterialSets.isDiscoverableBlockEntityMaterial(Material.BARREL));
        assertTrue(MaterialSets.isDiscoverableBlockEntityMaterial(Material.ENDER_CHEST));
        assertTrue(MaterialSets.isDiscoverableBlockEntityMaterial(Material.ENCHANTING_TABLE));
        assertTrue(MaterialSets.isDiscoverableBlockEntityMaterial(Material.BEACON));
        assertTrue(MaterialSets.isStateOnlyHiddenMaterial(Material.BOOKSHELF));
        assertFalse(MaterialSets.isDiscoverableBlockEntityMaterial(Material.BOOKSHELF));
        // Base-defining blocks with no block entity use the palette-prefiltered state scan.
        assertTrue(MaterialSets.isStateOnlyHiddenMaterial(Material.PISTON));
        assertTrue(MaterialSets.isStateOnlyHiddenMaterial(Material.STICKY_PISTON));
        assertTrue(MaterialSets.isStateOnlyHiddenMaterial(Material.PISTON_HEAD));
        assertTrue(MaterialSets.isStateOnlyHiddenMaterial(Material.CRAFTING_TABLE));
        assertTrue(MaterialSets.isStateOnlyHiddenMaterial(Material.CARTOGRAPHY_TABLE));
        assertTrue(MaterialSets.isStateOnlyHiddenMaterial(Material.FLETCHING_TABLE));
        assertTrue(MaterialSets.isStateOnlyHiddenMaterial(Material.SMITHING_TABLE));
        assertTrue(MaterialSets.isStateOnlyHiddenMaterial(Material.LOOM));
        assertTrue(MaterialSets.isStateOnlyHiddenMaterial(Material.STONECUTTER));
        assertTrue(MaterialSets.isStateOnlyHiddenMaterial(Material.GRINDSTONE));
        assertTrue(MaterialSets.isStateOnlyHiddenMaterial(Material.ANVIL));
        assertTrue(MaterialSets.isStateOnlyHiddenMaterial(Material.OBSERVER));
        assertTrue(MaterialSets.isStateOnlyHiddenMaterial(Material.TARGET));
        assertTrue(MaterialSets.isStateOnlyHiddenMaterial(Material.CAULDRON));
        assertTrue(MaterialSets.isStateOnlyHiddenMaterial(Material.RESPAWN_ANCHOR));
        assertFalse(MaterialSets.isDiscoverableBlockEntityMaterial(Material.PISTON),
                "a stationary piston has no block entity; state scanning must cover it");
        assertTrue(MaterialSets.isDiscoverableBlockEntityMaterial(Material.BELL));
        assertTrue(MaterialSets.isDiscoverableBlockEntityMaterial(Material.LODESTONE));
        assertTrue(MaterialSets.isDiscoverableBlockEntityMaterial(Material.RED_SHULKER_BOX));
        assertTrue(MaterialSets.isDiscoverableBlockEntityMaterial(Material.SPAWNER));
        assertTrue(MaterialSets.isDiscoverableBlockEntityMaterial(Material.TRIAL_SPAWNER));
        assertTrue(MaterialSets.isDiscoverableBlockEntityMaterial(Material.OAK_SIGN));
        assertTrue(MaterialSets.isDiscoverableBlockEntityMaterial(Material.RED_BED));
        assertTrue(MaterialSets.isDiscoverableBlockEntityMaterial(Material.PLAYER_HEAD));
    }

    @Test
    void plainBlocksAreRejected() {
        assertFalse(MaterialSets.isDiscoverableBlockEntityMaterial(Material.DIAMOND_ORE));
        assertFalse(MaterialSets.isDiscoverableBlockEntityMaterial(Material.STONE));
        assertFalse(MaterialSets.isDiscoverableBlockEntityMaterial(Material.AIR));
    }

    @Test
    void invalidEntriesProduceWarnings() {
        List<String> warnings = new ArrayList<>();
        Set<Material> materials = MaterialSets.parseHiddenMaterials(
                List.of("CHEST", "DIAMOND_ORE", "NOT_A_MATERIAL", "AIR"), warnings, "world");
        assertTrue(materials.contains(Material.CHEST));
        assertFalse(materials.contains(Material.DIAMOND_ORE));
        assertEquals(1, warnings.size());
        assertTrue(warnings.get(0).contains("DIAMOND_ORE"));
    }

    @Test
    void transparentDefaultsContainGlassAndWaterButNotStone() {
        Set<Material> transparent = MaterialSets.defaultTransparentBlocks();
        assertTrue(transparent.contains(Material.GLASS));
        assertTrue(transparent.contains(Material.WHITE_STAINED_GLASS));
        assertTrue(transparent.contains(Material.WATER));
        assertFalse(transparent.contains(Material.STONE));
        assertFalse(transparent.contains(Material.OAK_PLANKS));
    }

    @Test
    void thinSeeThroughBlocksDoNotOccludePlayersOrPens() {
        Set<Material> transparent = MaterialSets.defaultTransparentBlocks();
        assertTrue(transparent.contains(Material.OAK_FENCE));
        assertTrue(transparent.contains(Material.OAK_FENCE_GATE));
        assertTrue(transparent.contains(Material.COBBLESTONE_WALL));
        assertTrue(transparent.contains(Material.IRON_BARS));
        // Older versions use CHAIN; 1.21.9+ renamed it to IRON_CHAIN and added
        // copper variants. Resolve by name so the test compiles on every profile.
        Material chain = Material.matchMaterial("CHAIN");
        if (chain == null) {
            chain = Material.matchMaterial("IRON_CHAIN");
        }
        assertNotNull(chain, "a chain material should exist");
        assertTrue(transparent.contains(chain));
        // Solid cover must still occlude.
        assertFalse(transparent.contains(Material.OAK_DOOR));
        assertFalse(transparent.contains(Material.OAK_TRAPDOOR));
        assertFalse(transparent.contains(Material.OAK_LEAVES));
    }

    @Test
    void wildcardPatternsResolve() {
        List<String> warnings = new ArrayList<>();
        Set<Material> materials = MaterialSets.resolvePatterns(
                List.of("WHITE_STAINED_GLASS*", "GLASS"), warnings, "test",
                MaterialSets.defaultTransparentBlocks());
        assertTrue(materials.contains(Material.WHITE_STAINED_GLASS));
        assertTrue(materials.contains(Material.WHITE_STAINED_GLASS_PANE));
        assertTrue(materials.contains(Material.GLASS));
        assertTrue(warnings.isEmpty(), warnings.toString());
    }

    @Test
    void tileEntityTypeNamesFollowRegistryConventions() {
        assertEquals("chest", MaterialSets.tileEntityTypeName(Material.CHEST));
        assertEquals("trapped_chest", MaterialSets.tileEntityTypeName(Material.TRAPPED_CHEST));
        assertEquals("mob_spawner", MaterialSets.tileEntityTypeName(Material.SPAWNER));
        assertEquals("noteblock", MaterialSets.tileEntityTypeName(Material.NOTE_BLOCK));
        assertEquals("campfire", MaterialSets.tileEntityTypeName(Material.SOUL_CAMPFIRE));
        assertEquals("beehive", MaterialSets.tileEntityTypeName(Material.BEE_NEST));
        assertEquals("piston", MaterialSets.tileEntityTypeName(Material.MOVING_PISTON));
        assertEquals("command_block", MaterialSets.tileEntityTypeName(Material.CHAIN_COMMAND_BLOCK));
    }

    @Test
    void tileEntityTypeSuffixesMapToSharedRegistryTypes() {
        assertEquals("sign", MaterialSets.tileEntityTypeName(Material.OAK_SIGN));
        assertEquals("hanging_sign", MaterialSets.tileEntityTypeName(Material.OAK_HANGING_SIGN));
        assertEquals("banner", MaterialSets.tileEntityTypeName(Material.RED_BANNER));
        assertEquals("skull", MaterialSets.tileEntityTypeName(Material.PLAYER_HEAD));
        assertEquals("bed", MaterialSets.tileEntityTypeName(Material.RED_BED));
        assertEquals("shulker_box", MaterialSets.tileEntityTypeName(Material.RED_SHULKER_BOX));
    }

    @Test
    void nonTileEntityMaterialsHaveNoTypeName() {
        assertNull(MaterialSets.tileEntityTypeName(Material.STONE));
        assertNull(MaterialSets.tileEntityTypeName(Material.DIAMOND_ORE));
        assertNull(MaterialSets.tileEntityTypeName(Material.AIR));
        assertNull(MaterialSets.tileEntityTypeName(null));
    }

    @Test
    void tileEntityTypeNamesAreDeduplicated() {
        Set<String> names = MaterialSets.tileEntityTypeNames(
                Set.of(Material.OAK_SIGN, Material.BIRCH_SIGN, Material.CHEST, Material.SPAWNER));
        assertEquals(Set.of("sign", "chest", "mob_spawner"), names);
    }
}
