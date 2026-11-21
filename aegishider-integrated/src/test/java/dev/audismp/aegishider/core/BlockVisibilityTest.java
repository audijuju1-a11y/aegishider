package dev.audismp.aegishider.core;

import dev.audismp.aegishider.util.BlockPosUtil;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BlockVisibilityTest {

    @Test
    void absenceMeansHidden() {
        BlockVisibility visibility = new BlockVisibility();
        UUID viewer = UUID.randomUUID();
        visibility.addViewer(viewer);
        assertFalse(visibility.isRevealed(viewer, 42L));
    }

    @Test
    void revealAndHideTransitions() {
        BlockVisibility visibility = new BlockVisibility();
        UUID viewer = UUID.randomUUID();
        visibility.addViewer(viewer);
        long pos = BlockPosUtil.encode(10, 64, 10);
        assertTrue(visibility.markRevealed(viewer, pos));
        assertTrue(visibility.isRevealed(viewer, pos));
        assertFalse(visibility.markRevealed(viewer, pos), "second reveal is a no-op");
        assertTrue(visibility.markHidden(viewer, pos));
        assertFalse(visibility.isRevealed(viewer, pos));
    }

    @Test
    void chunkResyncDropsOnlyThatChunksMarkers() {
        BlockVisibility visibility = new BlockVisibility();
        UUID viewer = UUID.randomUUID();
        visibility.addViewer(viewer);
        long inChunk = BlockPosUtil.encode(5, 64, 5);
        long otherChunk = BlockPosUtil.encode(40, 64, 40);
        visibility.markRevealed(viewer, inChunk);
        visibility.markRevealed(viewer, otherChunk);
        long chunkKey = BlockPosUtil.chunkKey(1, 0, 0);
        assertEquals(1, visibility.clearChunk(viewer, chunkKey));
        assertFalse(visibility.isRevealed(viewer, inChunk));
        assertTrue(visibility.isRevealed(viewer, otherChunk));
    }

    @Test
    void enqueueResyncClearsMarkersImmediatelyAndDrains() {
        BlockVisibility visibility = new BlockVisibility();
        UUID viewer = UUID.randomUUID();
        visibility.addViewer(viewer);
        long pos = BlockPosUtil.encode(1, 70, 1);
        visibility.markRevealed(viewer, pos);
        long chunkKey = BlockPosUtil.chunkKey(3, 0, 0);
        visibility.enqueueResync(viewer, chunkKey);
        assertFalse(visibility.isRevealed(viewer, pos), "fail-closed: marker removed immediately");
        var drained = visibility.drainResync(8);
        assertEquals(1, drained.size());
        assertEquals(viewer, drained.get(0).viewer());
        assertEquals(chunkKey, drained.get(0).chunkKey());
        assertEquals(0, visibility.pendingResyncCount());
    }

    @Test
    void removingViewerDropsState() {
        BlockVisibility visibility = new BlockVisibility();
        UUID viewer = UUID.randomUUID();
        visibility.addViewer(viewer);
        visibility.markRevealed(viewer, 7L);
        visibility.removeViewer(viewer);
        assertFalse(visibility.isRevealed(viewer, 7L));
        assertEquals(0, visibility.totalRevealedMarkers());
    }
}
