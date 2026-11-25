package dev.audismp.aegishider.core;

import java.util.ArrayDeque;
import java.util.Iterator;
import java.util.UUID;

/**
 * Per-viewer chunk refresh jobs for the Y-shield.
 *
 * <p>A forced job is created when a bypass is revoked, because that client may still
 * hold unsanitized chunks. A later normal Y-crossing must not replace or evict that
 * security job before it completes. Normal jobs supersede other normal jobs for the
 * same player; forced jobs survive normal enqueues and are only replaced by a newer
 * forced job (which restarts the full re-send at the current position).
 */
public final class YShieldRefreshQueue<T> {

    public record Job<T>(UUID playerId, boolean forceShared, T payload, int index) {
        public Job<T> withIndex(int nextIndex) {
            return new Job<>(playerId, forceShared, payload, nextIndex);
        }
    }

    private final ArrayDeque<Job<T>> jobs = new ArrayDeque<>();
    private final int maxSize;

    public YShieldRefreshQueue(int maxSize) {
        if (maxSize < 1) {
            throw new IllegalArgumentException("maxSize must be positive");
        }
        this.maxSize = maxSize;
    }

    public void enqueue(UUID playerId, boolean forceShared, T payload) {
        if (forceShared) {
            // A new force request starts a complete re-send at the current position.
            jobs.removeIf(job -> job.playerId().equals(playerId));
        } else {
            // A normal crossing only supersedes older normal work for this player.
            jobs.removeIf(job -> job.playerId().equals(playerId) && !job.forceShared());
        }

        while (jobs.size() >= maxSize) {
            if (!evictOldestNormal()) {
                if (forceShared) {
                    jobs.pollFirst();
                } else {
                    // Never evict a forced security job to make room for a normal one.
                    return;
                }
            }
        }
        if (forceShared) {
            // Security work is not delayed behind normal crossings for other players.
            jobs.addFirst(new Job<>(playerId, true, payload, 0));
        } else {
            jobs.addLast(new Job<>(playerId, false, payload, 0));
        }
    }

    public Job<T> poll() {
        return jobs.pollFirst();
    }

    public void requeue(Job<T> job) {
        if (job.forceShared()) {
            // Keep the forced re-send at the head until it completes; a normal job
            // added mid-flight must not halve its progress.
            jobs.addFirst(job);
        } else {
            jobs.addLast(job);
        }
    }

    public int size() {
        return jobs.size();
    }

    private boolean evictOldestNormal() {
        Iterator<Job<T>> iterator = jobs.iterator();
        while (iterator.hasNext()) {
            if (!iterator.next().forceShared()) {
                iterator.remove();
                return true;
            }
        }
        return false;
    }
}
