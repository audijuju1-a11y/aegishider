package dev.audismp.aegishider.detection;

import dev.audismp.aegishider.config.AegishiderConfig;
import org.bukkit.Material;

import java.util.EnumSet;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Optional mining analytics: suspicious ore-rate and tunnel-streak indicators.
 *
 * <p>This is DETECTION ONLY. It never changes visibility, never cancels events and never
 * bans/kicks. Alerting is rate limited per player and delivered by the caller.
 * All state is main-thread only, bounded per player and cleared on quit.
 */
public final class MiningAnalytics {

    private static final int WINDOW = 256;

    private static final Set<Material> VALUABLE_ORES = EnumSet.of(
            Material.DIAMOND_ORE, Material.DEEPSLATE_DIAMOND_ORE,
            Material.ANCIENT_DEBRIS,
            Material.EMERALD_ORE, Material.DEEPSLATE_EMERALD_ORE,
            Material.GOLD_ORE, Material.DEEPSLATE_GOLD_ORE
    );

    private static final class PlayerState {
        final int[] x = new int[WINDOW];
        final int[] y = new int[WINDOW];
        final int[] z = new int[WINDOW];
        final boolean[] ore = new boolean[WINDOW];
        int head;
        int size;
        int ores;
        int dx;
        int dy;
        int dz;
        int streak;
        long lastAlertMs;
        int alerts;

        void push(int px, int py, int pz, boolean isOre) {
            int next = (head + 1) % WINDOW;
            if (size == WINDOW) {
                if (ore[head]) {
                    ores--;
                }
            } else {
                size++;
            }
            x[next] = px;
            y[next] = py;
            z[next] = pz;
            ore[next] = isOre;
            if (isOre) {
                ores++;
            }
            int previous = head;
            head = next;
            if (size >= 2) {
                int ndx = Integer.signum(x[head] - x[previous]);
                int ndy = Integer.signum(y[head] - y[previous]);
                int ndz = Integer.signum(z[head] - z[previous]);
                if (ndx == dx && ndy == dy && ndz == dz) {
                    streak++;
                } else {
                    dx = ndx;
                    dy = ndy;
                    dz = ndz;
                    streak = 1;
                }
            }
        }

        double orePercent() {
            return size == 0 ? 0.0 : (double) ores / size * 100.0;
        }
    }

    private final Map<UUID, PlayerState> states = new HashMap<>(64);

    public record Suspicion(boolean suspicious, boolean tunnel, double orePercent, int tunnelStreak) {
        public static final Suspicion NONE = new Suspicion(false, false, 0.0, 0);
    }

    /** Records a mined block. Returns a suspicion snapshot (never null). */
    public Suspicion recordMine(UUID player, AegishiderConfig.MiningSettings settings,
                                Material material, int x, int y, int z) {
        if (!settings.enabled()) {
            return Suspicion.NONE;
        }
        PlayerState state = states.computeIfAbsent(player, key -> new PlayerState());
        boolean isOre = VALUABLE_ORES.contains(material);
        state.push(x, y, z, isOre);
        boolean oreSuspicious = state.size >= settings.minSamples()
                && state.orePercent() >= settings.xrayOreRatePercent();
        boolean tunnel = state.streak >= settings.tunnelStreakBlocks();
        if (!oreSuspicious && !tunnel) {
            return new Suspicion(false, false, state.orePercent(), state.streak);
        }
        long now = System.currentTimeMillis();
        long cooldownMs = settings.alertCooldownSeconds() * 1000L;
        if (now - state.lastAlertMs < cooldownMs) {
            return new Suspicion(true, tunnel, state.orePercent(), state.streak);
        }
        state.lastAlertMs = now;
        state.alerts++;
        return new Suspicion(true, tunnel, state.orePercent(), state.streak);
    }

    public int alertCount(UUID player) {
        PlayerState state = states.get(player);
        return state == null ? 0 : state.alerts;
    }

    public void cleanup(UUID player) {
        states.remove(player);
    }

    public int trackedPlayers() {
        return states.size();
    }

    public void clear() {
        states.clear();
    }
}
