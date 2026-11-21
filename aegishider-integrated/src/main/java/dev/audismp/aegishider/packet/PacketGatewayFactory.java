package dev.audismp.aegishider.packet;

import dev.audismp.aegishider.AegishiderPlugin;
import dev.audismp.aegishider.core.BlockVisibility;
import dev.audismp.aegishider.core.SessionRegistry;
import dev.audismp.aegishider.index.HiddenBlockIndex;
import dev.audismp.aegishider.item.ItemShield;
import dev.audismp.aegishider.metrics.Metrics;

/**
 * Creates the packet gateway implementation when PacketEvents is available.
 *
 * <p>PacketEvents is deliberately a soft dependency: the plugin must still load and
 * protect entities natively when it is missing. However block/container protecting is
 * impossible without packet interception, so an unavailable gateway disables block
 * protection completely (reported in the log and in {@code /aegishider status}).
 */
public final class PacketGatewayFactory {

    private PacketGatewayFactory() {
    }

    public static PacketGateway create(AegishiderPlugin plugin, Metrics metrics,
                                       SessionRegistry sessions, HiddenBlockIndex index,
                                       BlockVisibility blockVisibility, ItemShield itemShield) {
        if (plugin.getServer().getPluginManager().getPlugin("packetevents") == null) {
            return new UnavailableGateway("PacketEvents plugin is not installed");
        }
        try {
            PacketEventsGateway gateway = new PacketEventsGateway(plugin, metrics, sessions, index,
                    blockVisibility, itemShield);
            return gateway;
        } catch (Throwable throwable) {
            // NoClassDefFoundError / LinkageError when PacketEvents is present but its API
            // is not visible yet, or any other initialisation problem.
            return new UnavailableGateway("packet gateway init failed: " + throwable);
        }
    }

    /** Real status object for the "feature is not available" state - not a fake backend. */
    private static final class UnavailableGateway implements PacketGateway {
        private final String reason;
        private volatile State state = State.UNAVAILABLE;

        private UnavailableGateway(String reason) {
            this.reason = reason;
        }

        @Override
        public boolean start() {
            return false;
        }

        @Override
        public boolean isActive() {
            return state == State.ACTIVE;
        }

        @Override
        public State state() {
            return state;
        }

        @Override
        public String statusLine() {
            return state + " (" + reason + ")";
        }

        @Override
        public int resendDroppedChunks() {
            return 0;
        }

        @Override
        public String diagnostics() {
            return "state=" + state + " reason=" + reason;
        }

        @Override
        public void drainDetectedBlockPositions() {
            // No packet layer available: nothing can be detected here.
        }

        @Override
        public int warmupMaterialMappings() {
            return 0;
        }

        @Override
        public String clientVersion(org.bukkit.entity.Player player) {
            return "unknown";
        }

        @Override
        public int detectedPendingCount() {
            return 0;
        }

        @Override
        public long detectedOverflowCount() {
            return 0;
        }

        @Override
        public void shutdown() {
            state = State.NOT_STARTED;
        }

        @Override
        public void reconfigure() {
            // Nothing to reconfigure while unavailable.
        }
    }
}
