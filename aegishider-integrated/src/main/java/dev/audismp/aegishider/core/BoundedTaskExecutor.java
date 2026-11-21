package dev.audismp.aegishider.core;

import dev.audismp.aegishider.metrics.Metrics;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.RejectedExecutionHandler;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Bounded async executor used ONLY for non-security-critical work (analytics, dashboards,
 * disk I/O). Visibility decisions never wait on this pool.
 *
 * <p>Properties:
 * <ul>
 *   <li>bounded queue ({@link ArrayBlockingQueue}) - no unbounded memory growth,</li>
 *   <li>explicit rejection policy: callers get {@code false} and decide how to fail
 *       (security callers keep state hidden; analytics simply drops the sample),</li>
 *   <li>fixed, daemon, low-priority thread pool sized from real CPU count,</li>
 *   <li>graceful shutdown with a hard deadline.</li>
 * </ul>
 */
public final class BoundedTaskExecutor implements AutoCloseable {

    private final ThreadPoolExecutor executor;
    private final Metrics metrics;
    private final int capacity;
    private final AtomicLong submitted = new AtomicLong();
    private final AtomicLong rejected = new AtomicLong();
    private final AtomicLong completed = new AtomicLong();

    public BoundedTaskExecutor(int threads, int queueCapacity, String threadNamePrefix, Metrics metrics) {
        if (threads < 1) {
            throw new IllegalArgumentException("threads must be >= 1");
        }
        if (queueCapacity < 1) {
            throw new IllegalArgumentException("queueCapacity must be >= 1");
        }
        this.metrics = metrics;
        this.capacity = queueCapacity;
        AtomicInteger counter = new AtomicInteger();
        ThreadFactory factory = runnable -> {
            Thread thread = new Thread(runnable, threadNamePrefix + "-" + counter.incrementAndGet());
            thread.setDaemon(true);
            thread.setPriority(Thread.MIN_PRIORITY + 1);
            return thread;
        };
        RejectedExecutionHandler rejectHandler = (r, pool) -> {
            throw new java.util.concurrent.RejectedExecutionException(
                    "Aegishider async queue saturated");
        };
        BlockingQueue<Runnable> queue = new ArrayBlockingQueue<>(queueCapacity);
        this.executor = new ThreadPoolExecutor(threads, threads, 30L, TimeUnit.SECONDS,
                queue, factory, rejectHandler);
        this.executor.allowCoreThreadTimeOut(true);
        if (metrics != null) {
            metrics.setAsyncQueue(0, capacity);
        }
    }

    /**
     * Attempts to run a task. Returns {@code false} when the queue is saturated or the pool
     * is shutting down. Callers must NOT assume the task ran.
     */
    public boolean submit(Runnable task) {
        if (task == null) {
            return false;
        }
        if (executor.isShutdown()) {
            return false;
        }
        submitted.incrementAndGet();
        try {
            executor.execute(() -> {
                try {
                    task.run();
                } finally {
                    completed.incrementAndGet();
                    if (metrics != null) {
                        metrics.recordAsyncQueue(executor.getQueue().size(), capacity);
                    }
                }
            });
            if (metrics != null) {
                metrics.recordAsyncTask();
                metrics.recordAsyncQueue(executor.getQueue().size(), capacity);
            }
            return true;
        } catch (RuntimeException ex) {
            rejected.incrementAndGet();
            if (metrics != null) {
                metrics.recordAsyncRejection();
            }
            return false;
        }
    }

    public int queueSize() {
        return executor.getQueue().size();
    }

    public int queueCapacity() {
        return capacity;
    }

    public int threadCount() {
        return executor.getPoolSize();
    }

    public long submitted() {
        return submitted.get();
    }

    public long rejected() {
        return rejected.get();
    }

    public long completed() {
        return completed.get();
    }

    @Override
    public void close() {
        executor.shutdown();
        try {
            if (!executor.awaitTermination(2, TimeUnit.SECONDS)) {
                executor.shutdownNow();
            }
        } catch (InterruptedException e) {
            executor.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }
}
