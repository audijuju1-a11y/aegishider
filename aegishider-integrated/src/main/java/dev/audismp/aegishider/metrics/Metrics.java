package dev.audismp.aegishider.metrics;

import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.LongAdder;

/**
 * Lock-free counters and gauges for diagnostics. All hot-path methods are a single
 * atomic operation; nothing here allocates or locks.
 */
public final class Metrics {

    // ── Security outcome counters ──────────────────────────────────────────
    private final LongAdder hiddenBlocksRegistered = new LongAdder();
    private final LongAdder hiddenBlocksRemoved = new LongAdder();
    private final LongAdder chunksFlaggedSensitive = new LongAdder();
    private final LongAdder chunkPacketsSanitized = new LongAdder();
    private final LongAdder chunkPacketsBlockedFailClosed = new LongAdder();
    private final LongAdder chunkPacketsPassed = new LongAdder();
    private final LongAdder blockChangesFaked = new LongAdder();
    private final LongAdder blockEntityPacketsBlocked = new LongAdder();
    private final LongAdder blockActionPacketsBlocked = new LongAdder();
    private final LongAdder itemSpawnPacketsBlocked = new LongAdder();
    private final LongAdder itemStatePacketsBlocked = new LongAdder();
    private final LongAdder unexpectedItemSpawnPacketsBlocked = new LongAdder();
    private final LongAdder blocksRevealed = new LongAdder();
    private final LongAdder blocksRehidden = new LongAdder();
    private final LongAdder itemsTracked = new LongAdder();
    private final LongAdder itemsUntracked = new LongAdder();
    private final LongAdder itemReveals = new LongAdder();
    private final LongAdder itemHides = new LongAdder();
    private final LongAdder entityPacketsCancelled = new LongAdder();
    private final LongAdder earlyEntitySpawnBlocked = new LongAdder();
    private final LongAdder packetsObserved = new LongAdder();
    private final LongAdder playersHidden = new LongAdder();
    private final LongAdder playersShown = new LongAdder();
    private final LongAdder yShieldSections = new LongAdder();
    private final LongAdder tunnelBlocksMasked = new LongAdder();

    // ── Work / timing counters ─────────────────────────────────────────────
    private final LongAdder raycasts = new LongAdder();
    private final LongAdder raycastBudgetDeferred = new LongAdder();
    private final LongAdder itemEvaluations = new LongAdder();
    private final LongAdder itemStormBatches = new LongAdder();
    private final AtomicLong itemStormMaxDepth = new AtomicLong();
    private final LongAdder blockEvaluations = new LongAdder();
    private final LongAdder tickOverruns = new LongAdder();
    private final LongAdder internalErrors = new LongAdder();
    private final LongAdder configWarnings = new LongAdder();
    private final LongAdder asyncRejections = new LongAdder();
    private final LongAdder asyncTasks = new LongAdder();

    private final AtomicLong lastTickNanos = new AtomicLong();
    private final AtomicLong maxTickNanos = new AtomicLong();
    private final AtomicLong totalTickNanos = new AtomicLong();
    private final AtomicLong ticks = new AtomicLong();

    /** Tick-duration histogram: 64 buckets x 50 us (main thread only). */
    private static final long HISTOGRAM_BUCKET_NANOS = 50_000L;
    private static final int HISTOGRAM_BUCKETS = 64;
    private final int[] tickHistogram = new int[HISTOGRAM_BUCKETS];

    private final AtomicLong lastItemDecisionNanos = new AtomicLong();
    private final AtomicLong maxItemDecisionNanos = new AtomicLong();
    private final AtomicLong lastBlockDecisionNanos = new AtomicLong();
    private final AtomicLong maxBlockDecisionNanos = new AtomicLong();

    // ── Volatile gauges ────────────────────────────────────────────────────
    private volatile int hiddenBlockCount;
    private volatile int sensitiveChunkCount;
    private volatile int trackedItemCount;
    private volatile int revealedItemViewerPairs;
    private volatile int asyncQueueSize;
    private volatile int asyncQueueCapacity;
    private volatile int asyncThreads;
    private volatile int onlineSessions;

    public void recordHiddenBlockRegistered() { hiddenBlocksRegistered.increment(); }
    public void recordHiddenBlockRemoved() { hiddenBlocksRemoved.increment(); }
    public void recordChunkFlagged() { chunksFlaggedSensitive.increment(); }
    public void recordChunkSanitized() { chunkPacketsSanitized.increment(); }
    public void recordChunkFailClosed() { chunkPacketsBlockedFailClosed.increment(); }
    public void recordChunkPassed() { chunkPacketsPassed.increment(); }
    public void recordBlockChangeFaked() { blockChangesFaked.increment(); }
    public void recordBlockEntityBlocked() { blockEntityPacketsBlocked.increment(); }
    public void recordBlockActionBlocked() { blockActionPacketsBlocked.increment(); }
    public void recordItemSpawnBlocked() { itemSpawnPacketsBlocked.increment(); }
    public void recordItemStateBlocked() { itemStatePacketsBlocked.increment(); }
    public void recordUnexpectedItemSpawnBlocked() { unexpectedItemSpawnPacketsBlocked.increment(); }
    public void recordBlockRevealed() { blocksRevealed.increment(); }
    public void recordBlockRehidden() { blocksRehidden.increment(); }
    public void recordItemTracked() { itemsTracked.increment(); }
    public void recordItemUntracked() { itemsUntracked.increment(); }
    public void recordItemReveal() { itemReveals.increment(); }
    public void recordItemHide() { itemHides.increment(); }
    public void recordEntityPacketCancelled() { entityPacketsCancelled.increment(); }
    public void recordEarlyEntitySpawnBlocked() { earlyEntitySpawnBlocked.increment(); }
    public void recordPacketObserved() { packetsObserved.increment(); }
    public void recordPlayerHidden() { playersHidden.increment(); }
    public void recordPlayerShown() { playersShown.increment(); }
    public void recordYShieldSection() { yShieldSections.increment(); }
    public void recordTunnelBlockMasked() { tunnelBlocksMasked.increment(); }
    public void recordRaycast() { raycasts.increment(); }
    public void recordRaycastDeferred() { raycastBudgetDeferred.increment(); }
    public void recordItemEvaluation() { itemEvaluations.increment(); }
    public void recordItemStorm(int depth) {
        itemStormBatches.increment();
        itemStormMaxDepth.accumulateAndGet(depth, Math::max);
    }
    public void recordBlockEvaluation() { blockEvaluations.increment(); }
    public void recordInternalError() { internalErrors.increment(); }
    public void recordConfigWarning() { configWarnings.increment(); }
    public void recordAsyncRejection() { asyncRejections.increment(); }
    public void recordAsyncTask() { asyncTasks.increment(); }
    public void recordAsyncQueue(int size, int capacity) { asyncQueueSize = size; asyncQueueCapacity = capacity; }

    public void recordTick(long nanos, long budgetNanos) {
        int bucket = (int) Math.min(HISTOGRAM_BUCKETS - 1, Math.max(0, nanos / HISTOGRAM_BUCKET_NANOS));
        tickHistogram[bucket]++;
        lastTickNanos.set(nanos);
        totalTickNanos.addAndGet(nanos);
        ticks.incrementAndGet();
        maxTickNanos.accumulateAndGet(nanos, Math::max);
        if (nanos > budgetNanos) {
            tickOverruns.increment();
        }
    }

    public void recordItemDecision(long nanos) {
        lastItemDecisionNanos.set(nanos);
        maxItemDecisionNanos.accumulateAndGet(nanos, Math::max);
    }

    public void recordBlockDecision(long nanos) {
        lastBlockDecisionNanos.set(nanos);
        maxBlockDecisionNanos.accumulateAndGet(nanos, Math::max);
    }

    public void setHiddenBlockCount(int v) { hiddenBlockCount = v; }
    public void setSensitiveChunkCount(int v) { sensitiveChunkCount = v; }
    public void setTrackedItemCount(int v) { trackedItemCount = v; }
    public void setRevealedItemViewerPairs(int v) { revealedItemViewerPairs = v; }
    public void setOnlineSessions(int v) { onlineSessions = v; }
    public void setAsyncThreads(int v) { asyncThreads = v; }
    public void setAsyncQueue(int size, int capacity) { asyncQueueSize = size; asyncQueueCapacity = capacity; }

    // ── Snapshot accessors for diagnostics / benchmarks ────────────────────
    public long hiddenBlocksRegistered() { return hiddenBlocksRegistered.sum(); }
    public long hiddenBlocksRemoved() { return hiddenBlocksRemoved.sum(); }
    public long chunkPacketsSanitized() { return chunkPacketsSanitized.sum(); }
    public long chunkPacketsBlockedFailClosed() { return chunkPacketsBlockedFailClosed.sum(); }
    public long chunkPacketsPassed() { return chunkPacketsPassed.sum(); }
    public long blockChangesFaked() { return blockChangesFaked.sum(); }
    public long blockEntityPacketsBlocked() { return blockEntityPacketsBlocked.sum(); }
    public long blockActionPacketsBlocked() { return blockActionPacketsBlocked.sum(); }
    public long itemSpawnPacketsBlocked() { return itemSpawnPacketsBlocked.sum(); }
    public long itemStatePacketsBlocked() { return itemStatePacketsBlocked.sum(); }
    public long unexpectedItemSpawnPacketsBlocked() { return unexpectedItemSpawnPacketsBlocked.sum(); }
    public long blocksRevealed() { return blocksRevealed.sum(); }
    public long blocksRehidden() { return blocksRehidden.sum(); }
    public long itemsTracked() { return itemsTracked.sum(); }
    public long itemsUntracked() { return itemsUntracked.sum(); }
    public long itemReveals() { return itemReveals.sum(); }
    public long itemHides() { return itemHides.sum(); }
    public long entityPacketsCancelled() { return entityPacketsCancelled.sum(); }
    public long earlyEntitySpawnBlocked() { return earlyEntitySpawnBlocked.sum(); }
    public long packetsObserved() { return packetsObserved.sum(); }
    public long playersHidden() { return playersHidden.sum(); }
    public long playersShown() { return playersShown.sum(); }
    public long yShieldSections() { return yShieldSections.sum(); }
    public long tunnelBlocksMasked() { return tunnelBlocksMasked.sum(); }
    public long raycasts() { return raycasts.sum(); }
    public long raycastBudgetDeferred() { return raycastBudgetDeferred.sum(); }
    public long itemEvaluations() { return itemEvaluations.sum(); }
    public long itemStormBatches() { return itemStormBatches.sum(); }
    public long itemStormMaxDepth() { return itemStormMaxDepth.get(); }
    public long blockEvaluations() { return blockEvaluations.sum(); }
    public long tickOverruns() { return tickOverruns.sum(); }
    public long internalErrors() { return internalErrors.sum(); }
    public long configWarnings() { return configWarnings.sum(); }
    public long asyncRejections() { return asyncRejections.sum(); }
    public long asyncTasks() { return asyncTasks.sum(); }

    public int hiddenBlockCount() { return hiddenBlockCount; }
    public int sensitiveChunkCount() { return sensitiveChunkCount; }
    public int trackedItemCount() { return trackedItemCount; }
    public int revealedItemViewerPairs() { return revealedItemViewerPairs; }
    public int asyncQueueSize() { return asyncQueueSize; }
    public int asyncQueueCapacity() { return asyncQueueCapacity; }
    public int asyncThreads() { return asyncThreads; }
    public int onlineSessions() { return onlineSessions; }

    public long totalTicks() { return ticks.get(); }
    /** Approximate percentile of Aegishider's own per-tick work, in nanoseconds. */
    public long tickPercentileNanos(double percentile) {
        long total = 0;
        for (int count : tickHistogram) {
            total += count;
        }
        if (total == 0) {
            return 0;
        }
        long target = (long) Math.ceil(total * Math.min(1.0, Math.max(0.0, percentile)));
        long seen = 0;
        for (int i = 0; i < HISTOGRAM_BUCKETS; i++) {
            seen += tickHistogram[i];
            if (seen >= target) {
                return (i + 1) * HISTOGRAM_BUCKET_NANOS;
            }
        }
        return HISTOGRAM_BUCKETS * HISTOGRAM_BUCKET_NANOS;
    }

    public long lastTickNanos() { return lastTickNanos.get(); }
    public long maxTickNanos() { return maxTickNanos.get(); }
    public long averageTickNanos() {
        long n = ticks.get();
        return n == 0 ? 0 : totalTickNanos.get() / n;
    }
    public long lastItemDecisionNanos() { return lastItemDecisionNanos.get(); }
    public long maxItemDecisionNanos() { return maxItemDecisionNanos.get(); }
    public long lastBlockDecisionNanos() { return lastBlockDecisionNanos.get(); }
    public long maxBlockDecisionNanos() { return maxBlockDecisionNanos.get(); }

    public void reset() {
        hiddenBlocksRegistered.reset(); hiddenBlocksRemoved.reset(); chunksFlaggedSensitive.reset();
        chunkPacketsSanitized.reset(); chunkPacketsBlockedFailClosed.reset(); chunkPacketsPassed.reset();
        blockChangesFaked.reset(); blockEntityPacketsBlocked.reset(); blockActionPacketsBlocked.reset();
        itemSpawnPacketsBlocked.reset(); itemStatePacketsBlocked.reset();
        unexpectedItemSpawnPacketsBlocked.reset(); blocksRevealed.reset(); blocksRehidden.reset();
        itemsTracked.reset(); itemsUntracked.reset(); itemReveals.reset(); itemHides.reset();
        entityPacketsCancelled.reset(); raycasts.reset(); raycastBudgetDeferred.reset();
        itemEvaluations.reset(); itemStormBatches.reset(); itemStormMaxDepth.set(0); blockEvaluations.reset(); tickOverruns.reset(); internalErrors.reset();
        configWarnings.reset(); asyncRejections.reset(); asyncTasks.reset();
        java.util.Arrays.fill(tickHistogram, 0);
        lastTickNanos.set(0); maxTickNanos.set(0); totalTickNanos.set(0); ticks.set(0);
        lastItemDecisionNanos.set(0); maxItemDecisionNanos.set(0);
        lastBlockDecisionNanos.set(0); maxBlockDecisionNanos.set(0);
    }
}
