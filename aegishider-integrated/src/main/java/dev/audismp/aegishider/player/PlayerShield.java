package dev.audismp.aegishider.player;

import dev.audismp.aegishider.AegishiderPlugin;
import dev.audismp.aegishider.config.WorldSettings;
import dev.audismp.aegishider.core.TimeBudget;
import dev.audismp.aegishider.metrics.Metrics;
import dev.audismp.aegishider.occlusion.OcclusionEngine;
import org.bukkit.entity.Player;
import org.bukkit.scoreboard.Team;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.logging.Level;

/**
 * Anti player-ESP engine. Uses Paper's per-player visibility API (hideEntity/showEntity) so
 * a cheat client never receives the spawn/metadata packets for a player it is not allowed
 * to see. Server-side gameplay (combat, teams, tab list, commands) is untouched.
 *
 * <p>The vertical (height) shield is always evaluated. The optional 24..48 block
 * distance layer (see {@link PlayerVisibilityPolicy}) is off by default: when enabled it
 * hides players behind walls unless the target has a clear line of sight. Field of view is
 * a 360-degree (disabled) opt-in by default because a third-person front view (F5 twice)
 * legitimately shows the world behind the player, and a narrow cone would hide objects
 * that are visibly on screen.
 */
public final class PlayerShield {

    private static final long COMBAT_PAIR_TTL_MS = 30_000L;

    private final AegishiderPlugin plugin;
    private final Metrics metrics;
    private final OcclusionEngine occlusion;
    private final Map<UUID, Set<UUID>> hiddenByViewer = new HashMap<>();
    private final Map<Long, Long> combatUntilMs = new HashMap<>();
    private int viewerCursor;

    public PlayerShield(AegishiderPlugin plugin, Metrics metrics, OcclusionEngine occlusion) {
        this.plugin = plugin;
        this.metrics = metrics;
        this.occlusion = occlusion;
    }

    /** Called by the damage listener for a player-vs-player hit. */
    public void markCombat(Player first, Player second) {
        if (first == null || second == null || first.getUniqueId().equals(second.getUniqueId())) {
            return;
        }
        long key = pairKey(first.getUniqueId(), second.getUniqueId());
        WorldSettings settings = plugin.config().world(first.getWorld().getName());
        int grace = settings.playerProtection().combatGraceSeconds();
        if (grace <= 0) {
            return;
        }
        combatUntilMs.put(key, System.currentTimeMillis() + grace * 1000L);
    }

    public void onViewerQuit(UUID viewerId) {
        hiddenByViewer.remove(viewerId);
    }

    /**
     * Main thread, budgeted. Walks every viewer in round-robin order so a player is not
     * skipped for several seconds just because many players are online. Height checks are
     * cheap and do not raycast; the optional distance layer stops when the time budget is
     * exhausted and resumes with the next viewer on the following tick.
     */
    public void tick(TimeBudget budget) {
        List<Player> online = new ArrayList<>(plugin.getServer().getOnlinePlayers());
        if (online.size() < 2) {
            return;
        }
        int count = online.size();
        int start = viewerCursor % count;
        int next = start;
        for (int i = 0; i < count; i++) {
            if (budget.expired()) {
                viewerCursor = next;
                return;
            }
            int index = (start + i) % count;
            next = (index + 1) % count;
            Player viewer = online.get(index);
            if (viewer == null || !viewer.isOnline()) {
                continue;
            }
            WorldSettings settings = plugin.config().world(viewer.getWorld().getName());
            WorldSettings.PlayerProtection policy = settings.playerProtection();
            if (!policy.enabled() && !settings.entityHeightShield().enabled()) {
                restoreViewer(viewer);
                continue;
            }
            evaluateViewer(viewer, settings, policy, online);
        }
        viewerCursor = 0;
    }

    private void evaluateViewer(Player viewer, WorldSettings settings,
                                WorldSettings.PlayerProtection policy, List<Player> online) {
        boolean bypass = viewer.hasPermission(settings.bypassPermission());
        Set<UUID> hidden = hiddenByViewer.computeIfAbsent(viewer.getUniqueId(), id -> new HashSet<>());
        var eye = viewer.getEyeLocation();
        double lookX = eye.getDirection().getX();
        double lookY = eye.getDirection().getY();
        double lookZ = eye.getDirection().getZ();
        double fovCos = policy.fovCosHalf();
        // The height shield is independent from the optional distance layer: a server can
        // keep the anti-base cross-floor rule without hiding same-floor players through
        // walls. FOV is disabled by default (360) because F5 front view and fast turns
        // would otherwise hide objects that are visibly on screen.
        boolean distanceHiding = policy.enabled() && policy.distanceHiding();
        WorldSettings.EntityHeightShield heightShield = settings.entityHeightShield();
        for (Player target : online) {
            if (target == null || !target.isOnline() || target.getUniqueId().equals(viewer.getUniqueId())) {
                continue;
            }
            if (!target.getWorld().equals(viewer.getWorld())) {
                // Different worlds are not tracked; make sure no stale hide remains.
                if (hidden.remove(target.getUniqueId())) {
                    viewer.showEntity(plugin, target);
                }
                continue;
            }
            double centerX = target.getX();
            double centerY = target.getY() + target.getHeight() * 0.5;
            double centerZ = target.getZ();
            double dx = centerX - eye.getX();
            double dy = centerY - eye.getY();
            double dz = centerZ - eye.getZ();
            double distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

            boolean sameTeam = policy.teamAware() && sameTeam(viewer, target);
            boolean combatGrace = isCombatGrace(viewer.getUniqueId(), target.getUniqueId());
            // Hard vertical band (anti-base-ESP): a player on another floor is hidden even
            // inside always-visible-distance, so a base at y=-50 never renders to the
            // surface and the surface never renders inside the base. It only applies when
            // at least one side is below the configured underground Y, so mountains,
            // towers and elytra flight stay visible.
            boolean verticalBlocked = !bypass && !sameTeam && !combatGrace
                    && heightShield.separates(eye.getY(), centerY);
            boolean inFov = true;
            boolean lineOfSight = true;
            if (distanceHiding && !verticalBlocked && !bypass && !sameTeam && !combatGrace
                    && distance > policy.alwaysVisibleDistance()
                    && distance <= policy.hideDistance()) {
                inFov = OcclusionEngine.insideFov(eye.getX(), eye.getY(), eye.getZ(),
                        lookX, lookY, lookZ, centerX, centerY, centerZ, fovCos);
                if (inFov) {
                    // Sample the head as well as the centre so a player peeking over a
                    // fence, stair or one-block ledge remains legitimately visible.
                    double headY = target.getY() + target.getHeight() * 0.85;
                    lineOfSight = occlusion.anyLineOfSight(viewer.getWorld(),
                            eye.getX(), eye.getY(), eye.getZ(),
                            centerX, centerZ, centerY, headY);
                }
            }
            PlayerVisibilityPolicy.Action action;
            if (verticalBlocked) {
                action = PlayerVisibilityPolicy.Action.HIDE;
            } else if (!distanceHiding) {
                action = PlayerVisibilityPolicy.Action.SHOW;
            } else {
                action = PlayerVisibilityPolicy.decide(bypass, sameTeam,
                        combatGrace, distance, policy.alwaysVisibleDistance(), policy.hideDistance(),
                        inFov, lineOfSight, policy.requireLineOfSight());
            }
            if (action == PlayerVisibilityPolicy.Action.HIDE) {
                if (hidden.add(target.getUniqueId())) {
                    metrics.recordPlayerHidden();
                    try {
                        viewer.hideEntity(plugin, target);
                    } catch (RuntimeException ex) {
                        hidden.remove(target.getUniqueId());
                        metrics.recordInternalError();
                        if (plugin.config().debug().verboseErrors()) {
                            plugin.getLogger().log(Level.WARNING,
                                    "Failed to hide player entity; fail-closed", ex);
                        }
                    }
                }
            } else if (hidden.remove(target.getUniqueId())) {
                metrics.recordPlayerShown();
                try {
                    viewer.showEntity(plugin, target);
                } catch (RuntimeException ex) {
                    metrics.recordInternalError();
                    if (plugin.config().debug().verboseErrors()) {
                        plugin.getLogger().log(Level.WARNING, "Failed to show player entity", ex);
                    }
                }
            }
        }
    }

    private boolean sameTeam(Player first, Player second) {
        Team firstTeam = first.getScoreboard().getEntryTeam(first.getName());
        if (firstTeam == null) {
            return false;
        }
        Team secondTeam = second.getScoreboard().getEntryTeam(second.getName());
        return secondTeam != null && firstTeam.getName().equals(secondTeam.getName());
    }

    private boolean isCombatGrace(UUID first, UUID second) {
        Long until = combatUntilMs.get(pairKey(first, second));
        if (until == null) {
            return false;
        }
        if (until < System.currentTimeMillis()) {
            combatUntilMs.remove(pairKey(first, second));
            return false;
        }
        return true;
    }

    private static long pairKey(UUID first, UUID second) {
        long high = first.getMostSignificantBits() ^ second.getMostSignificantBits();
        long low = first.getLeastSignificantBits() ^ second.getLeastSignificantBits();
        return high * 31L + low;
    }

    private void restoreViewer(Player viewer) {
        Set<UUID> hidden = hiddenByViewer.remove(viewer.getUniqueId());
        if (hidden == null || hidden.isEmpty()) {
            return;
        }
        for (UUID targetId : hidden) {
            Player target = plugin.getServer().getPlayer(targetId);
            if (target != null && target.isOnline()) {
                try {
                    viewer.showEntity(plugin, target);
                } catch (RuntimeException ex) {
                    metrics.recordInternalError();
                }
            }
        }
    }

    /** Plugin disable/reload: restore vanilla visibility for every hidden pair. */
    public void shutdownRestoreVisibility() {
        for (Map.Entry<UUID, Set<UUID>> entry : hiddenByViewer.entrySet()) {
            Player viewer = plugin.getServer().getPlayer(entry.getKey());
            if (viewer == null) {
                continue;
            }
            for (UUID targetId : new ArrayList<>(entry.getValue())) {
                Player target = plugin.getServer().getPlayer(targetId);
                if (target != null && target.isOnline()) {
                    try {
                        viewer.showEntity(plugin, target);
                    } catch (RuntimeException ex) {
                        metrics.recordInternalError();
                    }
                }
            }
        }
        hiddenByViewer.clear();
        combatUntilMs.clear();
    }

    public int hiddenPairCount() {
        int count = 0;
        for (Set<UUID> hidden : hiddenByViewer.values()) {
            count += hidden.size();
        }
        return count;
    }

    public String diagnostics() {
        return "hiddenPairs=" + hiddenPairCount() + " combatPairs=" + combatUntilMs.size();
    }
}
