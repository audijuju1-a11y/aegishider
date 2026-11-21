package dev.audismp.aegishider.player;

/**
 * Pure player-vs-player visibility policy. The priority order is deliberate so that
 * legitimate gameplay is never broken:
 *
 * <ol>
 *   <li>bypass viewers, same scoreboard team and recent combat pairs are always visible;</li>
 *   <li>everyone within {@code alwaysVisibleDistance} is always visible (no invisible
 *       close-range fights);</li>
 *   <li>beyond {@code hideDistance} everything is hidden (beyond normal client tracking);</li>
 *   <li>in between, a player is shown only when inside the optional FOV (360 disables
 *       the gate) and (optionally) an unobstructed voxel line of sight exists - this is
 *       what removes through-wall player ESP without making players disappear in open
 *       view or when a third-person camera sees the world behind the player.</li>
 * </ol>
 */
public final class PlayerVisibilityPolicy {

    public enum Action {
        SHOW, HIDE
    }

    private PlayerVisibilityPolicy() {
    }

    /**
     * @param viewerBypass    viewer has the bypass permission
     * @param sameTeam        viewer and target are on the same scoreboard team
     * @param combatGrace     the pair is inside its post-combat reveal window
     * @param distance        eye-to-target-centre distance
     * @param alwaysVisible   players closer than this are always shown
     * @param hideDistance    players farther than this are always hidden
     * @param inFov           target is inside the viewer's FOV cone
     * @param lineOfSight     ray trace shows no solid occluder between eye and target
     * @param requireLineOfSight whether line of sight is required at all
     */
    public static Action decide(boolean viewerBypass, boolean sameTeam, boolean combatGrace,
                                double distance, double alwaysVisible, double hideDistance,
                                boolean inFov, boolean lineOfSight, boolean requireLineOfSight) {
        if (viewerBypass || sameTeam || combatGrace) {
            return Action.SHOW;
        }
        if (distance <= alwaysVisible) {
            return Action.SHOW;
        }
        if (distance > hideDistance) {
            return Action.HIDE;
        }
        if (!inFov) {
            return Action.HIDE;
        }
        if (requireLineOfSight && !lineOfSight) {
            return Action.HIDE;
        }
        return Action.SHOW;
    }
}
