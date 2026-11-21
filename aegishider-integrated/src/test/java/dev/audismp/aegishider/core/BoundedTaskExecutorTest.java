package dev.audismp.aegishider.core;

import dev.audismp.aegishider.metrics.Metrics;
import org.junit.jupiter.api.Test;

import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BoundedTaskExecutorTest {

    @Test
    void executesTasks() {
        Metrics metrics = new Metrics();
        try (BoundedTaskExecutor executor = new BoundedTaskExecutor(2, 8, "test", metrics)) {
            AtomicInteger counter = new AtomicInteger();
            for (int i = 0; i < 4; i++) {
                assertTrue(executor.submit(counter::incrementAndGet));
            }
            long deadline = System.currentTimeMillis() + 5_000;
            while (counter.get() < 4 && System.currentTimeMillis() < deadline) {
                Thread.onSpinWait();
            }
            assertEquals(4, counter.get());
        }
    }

    @Test
    void rejectsWhenQueueAndWorkersAreSaturated() throws InterruptedException {
        Metrics metrics = new Metrics();
        try (BoundedTaskExecutor executor = new BoundedTaskExecutor(1, 1, "test", metrics)) {
            // Block the single worker until we release it.
            var latch = new java.util.concurrent.CountDownLatch(1);
            var started = new java.util.concurrent.CountDownLatch(1);
            executor.submit(() -> {
                started.countDown();
                try {
                    latch.await();
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                }
            });
            started.await();
            assertTrue(executor.submit(() -> { })); // fills the queue (capacity 1)
            assertFalse(executor.submit(() -> { }), "saturated queue must reject, not block");
            assertTrue(executor.rejected() >= 1);
            latch.countDown();
        }
    }

    @Test
    void rejectsAfterClose() {
        BoundedTaskExecutor executor = new BoundedTaskExecutor(1, 4, "test", null);
        executor.close();
        assertFalse(executor.submit(() -> { }));
    }

    @Test
    void queueStatsAreExposed() {
        try (BoundedTaskExecutor executor = new BoundedTaskExecutor(1, 16, "test", null)) {
            assertEquals(16, executor.queueCapacity());
            assertEquals(0, executor.queueSize());
        }
    }
}
