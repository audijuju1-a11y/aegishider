package dev.audismp.aegishider.index;

import dev.audismp.aegishider.metrics.Metrics;
import dev.audismp.aegishider.util.BlockPosUtil;
import it.unimi.dsi.fastutil.longs.LongOpenHashSet;
import org.bukkit.Material;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HiddenBlockIndexTest {

    private static final long WORLD = 7L;

    private static long pos(int x, int y, int z) {
        return BlockPosUtil.encode(x, y, z);
    }

    @Test
    void registerAndLookupAreWorldAware() {
        HiddenBlockIndex index = new HiddenBlockIndex(new Metrics());
        long block = pos(10, 64, 10);
        assertTrue(index.register(WORLD, block));
        assertTrue(index.isHidden(WORLD, block));
        assertFalse(index.isHidden(WORLD + 1, block), "other world must not see the block");
        assertFalse(index.register(WORLD, block), "duplicate register is a no-op");
        assertEquals(1, index.worldBlockCount(WORLD));
        assertEquals(1, index.worldChunkCount(WORLD));
    }

    @Test
    void unregisterRemovesAndRevisionsAdvance() {
        HiddenBlockIndex index = new HiddenBlockIndex(new Metrics());
        long block = pos(3, 5, 3);
        index.register(WORLD, block);
        long revision = index.revision();
        assertTrue(index.unregister(WORLD, block));
        assertTrue(index.revision() > revision);
        assertFalse(index.isHidden(WORLD, block));
        assertEquals(0, index.worldBlockCount(WORLD));
        assertEquals(0, index.worldChunkCount(WORLD));
        assertNull(index.chunkView(WORLD, 0, 0));
    }

    @Test
    void unregisterLeavesAFiniteTombstoneFiller() {
        HiddenBlockIndex index = new HiddenBlockIndex(new Metrics());
        long block = pos(4, 70, 4);
        index.register(WORLD, block);
        index.setFiller(WORLD, block, Material.OAK_PLANKS);
        assertTrue(index.unregister(WORLD, block));
        assertEquals(Material.OAK_PLANKS, index.tombstoneFiller(WORLD, block));
        index.pruneTombstones(System.currentTimeMillis() + 20_000L);
        assertNull(index.tombstoneFiller(WORLD, block));
    }

    @Test
    void replaceChunkAddsAndRemovesAtomically() {
        HiddenBlockIndex index = new HiddenBlockIndex(new Metrics());
        long first = pos(1, 64, 1);
        long second = pos(2, 64, 2);
        index.register(WORLD, first);
        index.register(WORLD, second);
        LongOpenHashSet discovered = new LongOpenHashSet();
        long third = pos(3, 64, 3);
        discovered.add(second);
        discovered.add(third);
        int changed = index.replaceChunk(WORLD, 0, 0, discovered);
        assertEquals(2, changed, "one added + one removed");
        assertFalse(index.isHidden(WORLD, first));
        assertTrue(index.isHidden(WORLD, second));
        assertTrue(index.isHidden(WORLD, third));
    }

    @Test
    void emptyReplaceClearsChunk() {
        HiddenBlockIndex index = new HiddenBlockIndex(new Metrics());
        index.register(WORLD, pos(4, 64, 4));
        assertEquals(1, index.replaceChunk(WORLD, 0, 0, new LongOpenHashSet()));
        assertNull(index.chunkView(WORLD, 0, 0));
        assertEquals(0, index.worldBlockCount(WORLD));
    }

    @Test
    void worldEvictionRemovesEverythingForThatWorld() {
        HiddenBlockIndex index = new HiddenBlockIndex(new Metrics());
        index.register(WORLD, pos(1, 1, 1));
        index.register(WORLD + 1, pos(1, 1, 1));
        index.evictWorld(WORLD);
        assertFalse(index.isHidden(WORLD, pos(1, 1, 1)));
        assertTrue(index.isHidden(WORLD + 1, pos(1, 1, 1)));
    }

    @Test
    void chunkViewBinarySearchFindsPositions() {
        HiddenBlockIndex index = new HiddenBlockIndex(null);
        for (int x = 0; x < 10; x++) {
            for (int z = 0; z < 10; z++) {
                index.register(WORLD, pos(x, 64, z));
            }
        }
        HiddenBlockIndex.ChunkView view = index.chunkView(WORLD, 0, 0);
        assertNotNull(view);
        assertEquals(100, view.size());
        assertTrue(view.contains(pos(5, 64, 5)));
        assertFalse(view.contains(pos(5, 65, 5)));
    }

    @Test
    void snapshotAllPositionsContainsEverything() {
        HiddenBlockIndex index = new HiddenBlockIndex(null);
        index.register(WORLD, pos(1, 2, 3));
        index.register(WORLD + 1, pos(4, 5, 6));
        long[] snapshot = index.snapshotAllPositions();
        assertEquals(2, snapshot.length);
        boolean foundFirst = false;
        boolean foundSecond = false;
        for (long value : snapshot) {
            foundFirst |= value == pos(1, 2, 3);
            foundSecond |= value == pos(4, 5, 6);
        }
        assertTrue(foundFirst && foundSecond);
    }

    @Test
    void sortedArrayHelpersKeepOrder() {
        long[] values = HiddenBlockIndex.insertSorted(new long[]{1L, 5L, 9L}, 7L);
        assertEquals(4, values.length);
        assertEquals(1L, values[0]);
        assertEquals(5L, values[1]);
        assertEquals(7L, values[2]);
        assertEquals(9L, values[3]);
        assertEquals(3, HiddenBlockIndex.removeSorted(values, 7L).length);
    }
}
