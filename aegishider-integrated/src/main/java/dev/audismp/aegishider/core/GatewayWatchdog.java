package dev.audismp.aegishider.core;

/**
 * Watches the packet gateway for two operational failure modes and raises one-shot signals
 * for the plugin to log/alarm:
 *
 * <ul>
 *   <li><b>stale gateway</b>: block protection is active and players are online, but the
 *       gateway has not processed any chunk/block packet for a long time (misconfiguration,
 *       PacketEvents broken after an update, listener unregistered).</li>
 *   <li><b>detected-position overflow</b>: the fail-closed bridge for packet-discovered
 *       protected positions exceeded its bound.</li>
 * </ul>
 *
 * <p>Pure and unit-tested; the caller only feeds a monotonic signature of gateway counters.
 */
public final class GatewayWatchdog {

    public enum Event {
        NONE,
        STALE_ACTIVITY,
        DETECTED_OVERFLOW
    }

    private final long staleThresholdMs;
    private long lastActivityMs;
    private long lastActivitySignature = Long.MIN_VALUE;
    private boolean staleReported;
    private long lastOverflowSeen;
    private boolean overflowReported;

    public GatewayWatchdog(long staleThresholdMs) {
        this.staleThresholdMs = Math.max(1_000L, staleThresholdMs);
    }

    /**
     * @param nowMs                current time (monotonic-ish; {@code System.currentTimeMillis()})
     * @param gatewaySignature     sum of gateway packet counters (changes on every packet)
     * @param onlineViewers        number of viewer sessions
     * @param blockProtectionActive whether the gateway is supposed to be enforcing
     * @param detectedOverflow     cumulative overflow count from the detected-position bridge
     */
    public Event update(long nowMs, long gatewaySignature, int onlineViewers,
                        boolean blockProtectionActive, long detectedOverflow) {
        if (detectedOverflow > lastOverflowSeen) {
            lastOverflowSeen = detectedOverflow;
            if (!overflowReported) {
                overflowReported = true;
                return Event.DETECTED_OVERFLOW;
            }
        }
        if (!blockProtectionActive || onlineViewers <= 0) {
            lastActivityMs = nowMs;
            lastActivitySignature = gatewaySignature;
            staleReported = false;
            return Event.NONE;
        }
        if (gatewaySignature != lastActivitySignature) {
            lastActivitySignature = gatewaySignature;
            lastActivityMs = nowMs;
            staleReported = false;
            return Event.NONE;
        }
        if (!staleReported && nowMs - lastActivityMs > staleThresholdMs) {
            staleReported = true;
            return Event.STALE_ACTIVITY;
        }
        return Event.NONE;
    }

    /** Age of the last observed gateway activity in ms (0 when protection/viewers inactive). */
    public long silentForMs(long nowMs) {
        return Math.max(0L, nowMs - lastActivityMs);
    }

    public boolean staleReported() {
        return staleReported;
    }

    public void reset() {
        lastActivitySignature = Long.MIN_VALUE;
        staleReported = false;
        overflowReported = false;
    }
}
