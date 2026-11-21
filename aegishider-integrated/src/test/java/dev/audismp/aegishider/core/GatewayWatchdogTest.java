package dev.audismp.aegishider.core;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GatewayWatchdogTest {

    private static final long THRESHOLD = 5_000L;

    @Test
    void reportsNothingWhileGatewayActivityIsObserved() {
        GatewayWatchdog watchdog = new GatewayWatchdog(THRESHOLD);
        assertEquals(GatewayWatchdog.Event.NONE,
                watchdog.update(1_000L, 1, 1, true, 0));
        assertEquals(GatewayWatchdog.Event.NONE,
                watchdog.update(4_000L, 2, 1, true, 0));
        assertEquals(GatewayWatchdog.Event.NONE,
                watchdog.update(9_000L, 3, 1, true, 0));
        assertFalse(watchdog.staleReported());
    }

    @Test
    void reportsStaleOnlyOnceThenResetsWhenActivityResumes() {
        GatewayWatchdog watchdog = new GatewayWatchdog(THRESHOLD);
        assertEquals(GatewayWatchdog.Event.NONE,
                watchdog.update(1_000L, 7, 2, true, 0));
        // Signature unchanged for exactly the threshold is not yet stale; beyond it is.
        assertEquals(GatewayWatchdog.Event.NONE,
                watchdog.update(6_000L, 7, 2, true, 0));
        assertEquals(GatewayWatchdog.Event.STALE_ACTIVITY,
                watchdog.update(6_001L, 7, 2, true, 0));
        assertEquals(GatewayWatchdog.Event.NONE,
                watchdog.update(20_000L, 7, 2, true, 0), "stale event must fire only once");
        // Activity resumes: watchdog rearms.
        assertEquals(GatewayWatchdog.Event.NONE,
                watchdog.update(21_000L, 8, 2, true, 0));
        assertEquals(GatewayWatchdog.Event.NONE,
                watchdog.update(26_000L, 8, 2, true, 0));
        assertEquals(GatewayWatchdog.Event.STALE_ACTIVITY,
                watchdog.update(26_001L, 8, 2, true, 0));
    }

    @Test
    void doesNotReportStaleWhenNobodyIsOnlineOrProtectionIsInactive() {
        GatewayWatchdog watchdog = new GatewayWatchdog(THRESHOLD);
        assertEquals(GatewayWatchdog.Event.NONE,
                watchdog.update(1_000L, 5, 0, true, 0));
        assertEquals(GatewayWatchdog.Event.NONE,
                watchdog.update(50_000L, 5, 0, true, 0));
        assertEquals(GatewayWatchdog.Event.NONE,
                watchdog.update(51_000L, 5, 3, false, 0));
    }

    @Test
    void reportsOverflowOncePerEpisode() {
        GatewayWatchdog watchdog = new GatewayWatchdog(THRESHOLD);
        assertEquals(GatewayWatchdog.Event.NONE,
                watchdog.update(1_000L, 1, 1, true, 0));
        assertEquals(GatewayWatchdog.Event.DETECTED_OVERFLOW,
                watchdog.update(2_000L, 1, 1, true, 4));
        assertEquals(GatewayWatchdog.Event.NONE,
                watchdog.update(3_000L, 1, 1, true, 9), "overflow alarm fires once per episode");
        watchdog.reset();
        assertEquals(GatewayWatchdog.Event.DETECTED_OVERFLOW,
                watchdog.update(4_000L, 1, 1, true, 10), "reset rearms the overflow alarm");
    }

    @Test
    void silentForClampsAtZero() {
        GatewayWatchdog watchdog = new GatewayWatchdog(THRESHOLD);
        assertEquals(0L, watchdog.silentForMs(0L));
        watchdog.update(5_000L, 1, 1, true, 0);
        assertEquals(2_000L, watchdog.silentForMs(7_000L));
        assertTrue(watchdog.silentForMs(4_000L) >= 0L);
    }
}
