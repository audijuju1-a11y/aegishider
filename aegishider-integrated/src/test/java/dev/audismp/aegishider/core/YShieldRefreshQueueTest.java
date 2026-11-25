package dev.audismp.aegishider.core;

import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class YShieldRefreshQueueTest {

    @Test
    void normalCrossingDoesNotCancelActiveForceJob() {
        YShieldRefreshQueue<String> queue = new YShieldRefreshQueue<>(8);
        UUID player = UUID.randomUUID();

        queue.enqueue(player, true, "bypass-revoked");
        YShieldRefreshQueue.Job<String> force = queue.poll();
        queue.requeue(force.withIndex(10));

        queue.enqueue(player, false, "y-crossing");

        assertEquals(2, queue.size());
        YShieldRefreshQueue.Job<String> first = queue.poll();
        assertTrue(first.forceShared(), "the force job must still run first");
        assertEquals(10, first.index(), "progress must not be reset by a normal crossing");
        assertEquals("bypass-revoked", first.payload());

        YShieldRefreshQueue.Job<String> normal = queue.poll();
        assertFalse(normal.forceShared());
        assertEquals("y-crossing", normal.payload());
    }

    @Test
    void normalCrossingReplacesOnlyOlderNormalWork() {
        YShieldRefreshQueue<String> queue = new YShieldRefreshQueue<>(8);
        UUID player = UUID.randomUUID();

        queue.enqueue(player, false, "old-normal");
        queue.enqueue(player, false, "new-normal");

        assertEquals(1, queue.size());
        assertEquals("new-normal", queue.poll().payload());
    }

    @Test
    void forceJobKeepsPriorityAfterNormalWorkArrives() {
        YShieldRefreshQueue<String> queue = new YShieldRefreshQueue<>(8);
        UUID player = UUID.randomUUID();

        queue.enqueue(player, true, "force");
        YShieldRefreshQueue.Job<String> force = queue.poll();
        queue.requeue(force.withIndex(1));
        queue.enqueue(player, false, "normal");

        YShieldRefreshQueue.Job<String> first = queue.poll();
        assertTrue(first.forceShared(), "the forced re-send keeps priority");
        queue.requeue(first.withIndex(2));
        YShieldRefreshQueue.Job<String> second = queue.poll();
        assertTrue(second.forceShared(), "normal work waits for the security re-send");
    }

    @Test
    void normalWorkCannotEvictForceJobAtCapacity() {
        YShieldRefreshQueue<String> queue = new YShieldRefreshQueue<>(1);
        UUID player = UUID.randomUUID();

        queue.enqueue(player, true, "force");
        queue.enqueue(player, false, "normal");

        assertEquals(1, queue.size());
        YShieldRefreshQueue.Job<String> remaining = queue.poll();
        assertTrue(remaining.forceShared());
        assertEquals("force", remaining.payload());
    }

    @Test
    void newForceRequestRestartsAtTheCurrentPosition() {
        YShieldRefreshQueue<String> queue = new YShieldRefreshQueue<>(8);
        UUID player = UUID.randomUUID();

        queue.enqueue(player, true, "old-force");
        YShieldRefreshQueue.Job<String> old = queue.poll();
        queue.requeue(old.withIndex(25));

        queue.enqueue(player, true, "new-force");

        assertEquals(1, queue.size());
        YShieldRefreshQueue.Job<String> restarted = queue.poll();
        assertTrue(restarted.forceShared());
        assertEquals(0, restarted.index());
        assertEquals("new-force", restarted.payload());
    }
}
