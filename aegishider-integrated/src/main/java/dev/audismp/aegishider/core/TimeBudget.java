package dev.audismp.aegishider.core;

import java.util.Objects;
import java.util.function.LongSupplier;

/** A monotonic, cooperative deadline shared by all work in a security tick. */
public final class TimeBudget {

    private final LongSupplier clock;
    private final long startNanos;
    private final long durationNanos;

    private TimeBudget(LongSupplier clock, long startNanos, long durationNanos) {
        this.clock = clock;
        this.startNanos = startNanos;
        this.durationNanos = durationNanos;
    }

    public static TimeBudget ofMillis(double millis) {
        return ofMillis(millis, System::nanoTime);
    }

    /** Clock injection keeps deadline tests deterministic (including nanoTime wraparound). */
    static TimeBudget ofMillis(double millis, LongSupplier clock) {
        Objects.requireNonNull(clock, "clock");
        return new TimeBudget(clock, clock.getAsLong(), nanos(millis));
    }

    /**
     * A phase may use at most this much time from now, and never outlive its parent.
     * Creating a child after the parent expired cannot restart the tick deadline.
     */
    public TimeBudget sliceMillis(double millis) {
        long now = clock.getAsLong();
        return new TimeBudget(clock, now, Math.min(nanos(millis), remainingAt(now)));
    }

    public boolean expired() {
        return remainingNanos() == 0;
    }

    public long remainingNanos() {
        return remainingAt(clock.getAsLong());
    }

    private long remainingAt(long now) {
        long elapsed = now - startNanos;
        return elapsed >= durationNanos ? 0 : durationNanos - elapsed;
    }

    public long elapsedNanos() {
        return clock.getAsLong() - startNanos;
    }

    private static long nanos(double millis) {
        return Double.isNaN(millis) || millis <= 0 ? 0
                : (long) Math.min(Long.MAX_VALUE, millis * 1_000_000.0);
    }
}
