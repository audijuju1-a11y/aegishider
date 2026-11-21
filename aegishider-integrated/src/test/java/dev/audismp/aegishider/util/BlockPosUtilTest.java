package dev.audismp.aegishider.util;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

class BlockPosUtilTest {

    @Test
    void encodesAndDecodesAllCoordinates() {
        int[][] samples = {
                {0, 0, 0},
                {1, -1, 1},
                {-1, 1, -1},
                {29_999_999, 319, 29_999_999},
                {-29_999_999, -64, -29_999_999},
                {12345, 64, -98765},
                {-33_554_432, -2048, 33_554_431},
        };
        for (int[] sample : samples) {
            long encoded = BlockPosUtil.encode(sample[0], sample[1], sample[2]);
            assertEquals(sample[0], BlockPosUtil.decodeX(encoded), "x of " + encoded);
            assertEquals(sample[1], BlockPosUtil.decodeY(encoded), "y of " + encoded);
            assertEquals(sample[2], BlockPosUtil.decodeZ(encoded), "z of " + encoded);
        }
    }

    @Test
    void chunkKeysDoNotCollideBetweenWorlds() {
        long first = BlockPosUtil.chunkKey(1, 0, 0);
        long second = BlockPosUtil.chunkKey(2, 0, 0);
        assertNotEquals(first, second);
        assertEquals(1, BlockPosUtil.worldIdOfChunkKey(first));
        assertEquals(2, BlockPosUtil.worldIdOfChunkKey(second));
        assertEquals(0, BlockPosUtil.chunkXOf(first));
        assertEquals(0, BlockPosUtil.chunkZOf(first));
    }

    @Test
    void chunkKeysDoNotCollideBetweenChunkCoordinates() {
        long a = BlockPosUtil.chunkKey(7, -1, -1);
        long b = BlockPosUtil.chunkKey(7, 1, 1);
        long c = BlockPosUtil.chunkKey(7, -1, 1);
        assertNotEquals(a, b);
        assertNotEquals(a, c);
        assertNotEquals(b, c);
        assertEquals(-1, BlockPosUtil.chunkXOf(a));
        assertEquals(-1, BlockPosUtil.chunkZOf(a));
        assertEquals(1, BlockPosUtil.chunkXOf(b));
    }

    @Test
    void chunkKeyOfBlockMatchesManualChunk() {
        int x = 1234;
        int z = -5678;
        long worldId = 42;
        long blockPos = BlockPosUtil.encode(x, 64, z);
        long fromBlock = BlockPosUtil.chunkKeyOfBlock(worldId, blockPos);
        long manual = BlockPosUtil.chunkKey(worldId, x >> 4, z >> 4);
        assertEquals(manual, fromBlock);
        assertEquals(worldId, BlockPosUtil.worldIdOfChunkKey(fromBlock));
    }

    @Test
    void packUnpackTwoInts() {
        assertEquals(123, BlockPosUtil.unpackA(BlockPosUtil.pack(123, -456)));
        assertEquals(-456, BlockPosUtil.unpackB(BlockPosUtil.pack(123, -456)));
        assertEquals(Integer.MIN_VALUE, BlockPosUtil.unpackA(BlockPosUtil.pack(Integer.MIN_VALUE, 0)));
        assertEquals(Integer.MAX_VALUE, BlockPosUtil.unpackB(BlockPosUtil.pack(0, Integer.MAX_VALUE)));
    }
}
