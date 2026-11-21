package dev.audismp.aegishider.player;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class PlayerVisibilityPolicyTest {

    private static final double ALWAYS = 24.0;
    private static final double HIDE = 48.0;

    private static PlayerVisibilityPolicy.Action decide(double distance, boolean fov,
                                                        boolean los, boolean requireLos) {
        return PlayerVisibilityPolicy.decide(false, false, false, distance, ALWAYS, HIDE,
                fov, los, requireLos);
    }

    @Test
    void bypassTeamAndCombatAlwaysShow() {
        assertEquals(PlayerVisibilityPolicy.Action.SHOW, PlayerVisibilityPolicy.decide(
                true, false, false, 1000.0, ALWAYS, HIDE, false, false, true));
        assertEquals(PlayerVisibilityPolicy.Action.SHOW, PlayerVisibilityPolicy.decide(
                false, true, false, 1000.0, ALWAYS, HIDE, false, false, true));
        assertEquals(PlayerVisibilityPolicy.Action.SHOW, PlayerVisibilityPolicy.decide(
                false, false, true, 1000.0, ALWAYS, HIDE, false, false, true));
    }

    @Test
    void closePlayersAreAlwaysVisible() {
        assertEquals(PlayerVisibilityPolicy.Action.SHOW, decide(8.0, false, false, true));
    }

    @Test
    void beyondHideDistanceIsHidden() {
        assertEquals(PlayerVisibilityPolicy.Action.HIDE, decide(60.0, true, true, true));
    }

    @Test
    void throughWallFarPlayerIsHidden() {
        assertEquals(PlayerVisibilityPolicy.Action.HIDE, decide(40.0, true, false, true));
        assertEquals(PlayerVisibilityPolicy.Action.HIDE, decide(40.0, false, true, true));
    }

    @Test
    void openLineOfSightInFovIsVisible() {
        assertEquals(PlayerVisibilityPolicy.Action.SHOW, decide(40.0, true, true, true));
        assertEquals(PlayerVisibilityPolicy.Action.SHOW, decide(40.0, true, false, false));
    }
}
