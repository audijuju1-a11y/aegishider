package dev.audismp.aegishider.packet;

/**
 * Abstraction over outgoing-packet interception.
 *
 * <p>Aegishider uses this only for functionality that cannot be implemented with Bukkit
 * events: removing protected blocks from chunk data and from block/entity packets before
 * they reach a client, and as defence-in-depth for the native entity visibility API.
 *
 * <p>When no implementation is available the gateway must report {@link #isActive()} as
 * false; the plugin then disables block protection entirely (fail-closed) instead of
 * pretending that blocks are protected.
 */
public interface PacketGateway {

    enum State {
        /** Packet interception is available and enforcing. */
        ACTIVE,
        /** PacketEvents is missing/incompatible: block protection is DISABLED. */
        UNAVAILABLE,
        /** Gateway failed while running: protection is suspended and reported loudly. */
        FAILED,
        /** Not started yet. */
        NOT_STARTED
    }

    /** Starts packet interception. Called once during plugin enable. */
    boolean start();

    boolean isActive();

    State state();

    /** Short, human readable status line for /aegishider status. */
    String statusLine();

    /**
     * Main thread, every tick: register block positions that the packet layer detected from
     * chunk block-entity data but which are not yet in the index, and schedule discovery.
     * Fail-closed bridge; harmless when nothing was detected.
     */
    void drainDetectedBlockPositions();

    /**
     * Main thread, every tick: registers entity UUIDs whose spawn packet arrived before the
     * main thread tracked the entity (items loaded outside the player sweep). The packet was
     * already cancelled fail-closed; registering lets the normal visibility engine reveal
     * the entity if it is legitimately visible.
     */
    void drainPendingEntityRegistrations();

    /**
     * Pre-loads PacketEvents block-state mappings and the configured protected materials so
     * the first player/chunk send does not pay lazy mapping/class-load cost.
     * @return number of resolved materials (0 when the gateway is unavailable)
     */
    int warmupMaterialMappings();

    /**
     * @return the client protocol version of an online player (e.g. {@code V_1_21_4}) or
     *         {@code "unknown"} when the packet layer cannot answer. Used by diagnostics to
     *         explain ViaVersion/protocol-related behaviour.
     */
    String clientVersion(org.bukkit.entity.Player player);

    /** Number of protected positions currently detected by the packet layer, not yet indexed. */
    int detectedPendingCount();

    /** Number of detected-position bridge entries dropped because its bound was exceeded. */
    long detectedOverflowCount();

    /**
     * Main thread maintenance: re-requests a bounded number of chunks whose sanitize path had
     * to cancel them (format/session failures). Prevents a permanent "Loading terrain" stall
     * without ever sending unsanitized data.
     * @return number of chunk refresh requests issued
     */
    int resendDroppedChunks();

    /** Called on plugin disable/reload. Must unregister listeners and never throw. */
    void shutdown();

    /** Live counters/state for /aegishider diag. */
    String diagnostics();

    /** Called after /aegishider reload with new configuration. */
    void reconfigure();
}
