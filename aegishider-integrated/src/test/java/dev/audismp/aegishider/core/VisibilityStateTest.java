package dev.audismp.aegishider.core;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class VisibilityStateTest {

    @Test
    void onlyVisibleAndBypassMaySendData() {
        assertTrue(VisibilityState.VISIBLE.maySendData());
        assertTrue(VisibilityState.BYPASS.maySendData());
        assertFalse(VisibilityState.HIDDEN.maySendData());
        assertFalse(VisibilityState.PENDING.maySendData());
        assertFalse(VisibilityState.UNKNOWN.maySendData());
    }

    @Test
    void failClosedDefaultIsUnknown() {
        assertFalse(VisibilityState.failClosed().maySendData());
    }
}
