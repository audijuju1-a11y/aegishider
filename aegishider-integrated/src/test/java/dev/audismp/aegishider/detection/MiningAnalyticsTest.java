package dev.audismp.aegishider.detection;

import dev.audismp.aegishider.config.AegishiderConfig;
import org.bukkit.Material;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MiningAnalyticsTest {

    private static final AegishiderConfig.MiningSettings ENABLED =
            new AegishiderConfig.MiningSettings(true, 5.0, 20, 8, 60);

    @Test
    void normalMiningIsNotSuspicious() {
        MiningAnalytics analytics = new MiningAnalytics();
        UUID player = UUID.randomUUID();
        for (int i = 0; i < 100; i++) {
            var result = analytics.recordMine(player, ENABLED, Material.STONE, i % 3, 64, i % 5);
            assertFalse(result.suspicious());
        }
        analytics.cleanup(player);
    }

    @Test
    void impossibleOreRateIsSuspicious() {
        MiningAnalytics analytics = new MiningAnalytics();
        UUID player = UUID.randomUUID();
        boolean suspicious = false;
        for (int i = 0; i < 40; i++) {
            suspicious |= analytics.recordMine(player, ENABLED, Material.DIAMOND_ORE, i, 64, 0)
                    .suspicious();
        }
        assertTrue(suspicious);
        assertEquals(1, analytics.alertCount(player), "alert is rate limited to one");
        analytics.cleanup(player);
    }

    @Test
    void straightTunnelIsDetected() {
        MiningAnalytics analytics = new MiningAnalytics();
        UUID player = UUID.randomUUID();
        boolean tunnel = false;
        for (int i = 0; i < 20; i++) {
            tunnel |= analytics.recordMine(player, ENABLED, Material.STONE, i, 64, 0).tunnel();
        }
        assertTrue(tunnel);
    }

    @Test
    void disablingAnalyticsShortCircuits() {
        MiningAnalytics analytics = new MiningAnalytics();
        UUID player = UUID.randomUUID();
        var disabled = new AegishiderConfig.MiningSettings(false, 0.0, 1, 1, 0);
        for (int i = 0; i < 100; i++) {
            assertFalse(analytics.recordMine(player, disabled, Material.DIAMOND_ORE, i, 64, 0)
                    .suspicious());
        }
        assertEquals(0, analytics.trackedPlayers());
    }
}
