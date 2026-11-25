package dev.audismp.aegishider;

import dev.audismp.aegishider.blocks.BlockShield;
import dev.audismp.aegishider.command.AegishiderCommand;
import dev.audismp.aegishider.config.AegishiderConfig;
import dev.audismp.aegishider.config.ConfigLoader;
import dev.audismp.aegishider.config.WorldSettings;
import dev.audismp.aegishider.core.BlockVisibility;
import dev.audismp.aegishider.core.BoundedTaskExecutor;
import dev.audismp.aegishider.core.ChunkRefreshPlan;
import dev.audismp.aegishider.core.RaycastBudget;
import dev.audismp.aegishider.core.SessionRegistry;
import dev.audismp.aegishider.core.TimeBudget;
import dev.audismp.aegishider.core.ViewerSession;
import dev.audismp.aegishider.core.WorldKeys;
import dev.audismp.aegishider.core.YShieldRefreshQueue;
import dev.audismp.aegishider.detection.MiningAnalytics;
import dev.audismp.aegishider.detection.RaidAnalytics;
import dev.audismp.aegishider.index.BlockDiscovery;
import dev.audismp.aegishider.index.HiddenBlockIndex;
import dev.audismp.aegishider.item.ItemShield;
import dev.audismp.aegishider.listener.BlockListener;
import dev.audismp.aegishider.listener.ChunkListener;
import dev.audismp.aegishider.listener.EntityListener;
import dev.audismp.aegishider.listener.PlayerListener;
import dev.audismp.aegishider.listener.WorldListener;
import dev.audismp.aegishider.core.GatewayWatchdog;
import dev.audismp.aegishider.maintenance.DiagnosticsExporter;
import dev.audismp.aegishider.metrics.Metrics;
import dev.audismp.aegishider.occlusion.OcclusionEngine;
import dev.audismp.aegishider.occlusion.PaperRayTracer;
import dev.audismp.aegishider.packet.PacketGateway;
import dev.audismp.aegishider.player.PlayerShield;
import dev.audismp.aegishider.tunnel.TunnelShield;
import dev.audismp.aegishider.packet.PacketGatewayFactory;
import dev.audismp.aegishider.platform.PlatformService;
import dev.audismp.aegishider.platform.ServerHealthSampler;
import dev.audismp.aegishider.util.BlockPosUtil;
import org.bukkit.Chunk;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.data.BlockData;
import org.bukkit.command.PluginCommand;
import org.bukkit.entity.Player;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.lang.management.ManagementFactory;
import java.lang.management.ThreadMXBean;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.logging.Level;

/**
 * Aegishider - fail-closed server-side anti-ESP.
 *
 * <p>Architecture (single source of truth for each concern):
 * <pre>
 *   HiddenBlockIndex      which blocks are protected (world-state derived)
 *   BlockVisibility       which protected blocks are currently shown to whom
 *   ItemShield            protected entities: native per-viewer visibility
 *   BlockShield           block reveal/re-hide policy (distance + optional FOV + occlusion)
 *   PacketEventsGateway   removes protected data from outgoing packets before send
 *   SessionRegistry       per-viewer world/policy snapshot for the packet thread
 *   BoundedTaskExecutor   non-security async work only (never in the security path)
 * </pre>
 *
 * <p>Main-thread work is sliced by a per-tick time budget. Visibility is fail-closed:
 * anything not positively proven visible stays hidden; when an error, timeout or queue
 * pressure occurs the protected data remains hidden.
 */
public final class AegishiderPlugin extends JavaPlugin {

    private static AegishiderPlugin instance;
    private static final ThreadMXBean THREAD_BEAN = ManagementFactory.getThreadMXBean();

    static {
        try {
            if (THREAD_BEAN.isThreadCpuTimeSupported() && !THREAD_BEAN.isThreadCpuTimeEnabled()) {
                THREAD_BEAN.setThreadCpuTimeEnabled(true);
            }
        } catch (RuntimeException ignored) {
            // CPU timing is diagnostic only; wall time remains the fallback.
        }
    }

    private volatile AegishiderConfig config;
    private Metrics metrics;
    private SessionRegistry sessions;
    private HiddenBlockIndex hiddenBlockIndex;
    private BlockVisibility blockVisibility;
    private BlockDiscovery blockDiscovery;
    private ItemShield itemShield;
    private BlockShield blockShield;
    private PlayerShield playerShield;
    private TunnelShield tunnelShield;
    private OcclusionEngine occlusionEngine;
    private PacketGateway packetGateway;
    private RaycastBudget raycastBudget;
    private BoundedTaskExecutor asyncPool;
    private MiningAnalytics miningAnalytics;
    private RaidAnalytics raidAnalytics;
    private GatewayWatchdog gatewayWatchdog;
    private DiagnosticsExporter diagnosticsExporter;
    private PlatformService platformService;
    private ServerHealthSampler serverHealth;

    private final List<Listener> registeredListeners = new ArrayList<>(8);
    private volatile boolean blockProtectionActive;
    private volatile boolean protectionStarted;
    private volatile boolean licenseGated;
    private int tickCounter;
    private int reconcilePlayerCursor;
    private long lastBudgetWarnMs;
    private long configRevision = 1L;
    private boolean packetWarmupDone;

    /**
     * Chunks being re-sent after a Y-shield crossing. A viewer who descends below the line
     * already has masked chunks client-side, so the real world only reappears when those
     * chunks are sent again; ascending needs the opposite. Spread over ticks to avoid a
     * teleport-time burst of the whole view distance.
     */
    private static final int Y_SHIELD_REFRESH_PER_TICK = 4;
    private static final int Y_SHIELD_REFRESH_MAX_QUEUE = 64;

    private final YShieldRefreshQueue<ChunkRefreshJob> yShieldRefreshes =
            new YShieldRefreshQueue<>(Y_SHIELD_REFRESH_MAX_QUEUE);

    private record ChunkRefreshJob(long worldId, List<ChunkRefreshPlan.Step> steps) {
    }

    @Override
    public void onEnable() {
        instance = this;
        try {
            saveDefaultConfig();
            loadConfig(1L);

            metrics = new Metrics();
            sessions = new SessionRegistry();
            hiddenBlockIndex = new HiddenBlockIndex(metrics);
            blockVisibility = new BlockVisibility();
            raycastBudget = new RaycastBudget(config.raycastBudgetPerTick());
            occlusionEngine = new OcclusionEngine(new PaperRayTracer(this::config, metrics));
            itemShield = new ItemShield(this, metrics, sessions, occlusionEngine);
            blockShield = new BlockShield(this, metrics, sessions, hiddenBlockIndex,
                    occlusionEngine, blockVisibility);
            playerShield = new PlayerShield(this, metrics, occlusionEngine);
            tunnelShield = new TunnelShield(this, metrics);
            blockDiscovery = new BlockDiscovery(this, hiddenBlockIndex, metrics);
            miningAnalytics = new MiningAnalytics();
            raidAnalytics = new RaidAnalytics();

            int asyncThreads = Math.max(1, Math.min(4, Runtime.getRuntime().availableProcessors() / 2));
            asyncPool = new BoundedTaskExecutor(asyncThreads, 512, "Aegishider-Async", metrics);
            metrics.setAsyncThreads(asyncThreads);
            gatewayWatchdog = new GatewayWatchdog(300_000L);
            diagnosticsExporter = new DiagnosticsExporter(this, getDataFolder().toPath());

            // ── Packet gateway object; started only when protection may run ──
            packetGateway = PacketGatewayFactory.create(this, metrics, sessions, hiddenBlockIndex,
                    blockVisibility, itemShield);

            // Command first: /aegishider license ... must work while protection is gated.
            AegishiderCommand commandExecutor = new AegishiderCommand(this);
            PluginCommand command = getCommand("aegishider");
            if (command != null) {
                command.setExecutor(commandExecutor);
                command.setTabCompleter(commandExecutor);
            } else {
                getLogger().severe("Command 'aegishider' missing from plugin.yml");
            }

            // Platform licence/telemetry client. It also owns the activation gate:
            // when enforcement is ENFORCE, protection starts only after a signed lease.
            try {
                platformService = new PlatformService(this);
                platformService.start();
            } catch (Throwable throwable) {
                getLogger().log(Level.WARNING,
                        "Platform licensing client disabled: " + throwable.getMessage(), throwable);
            }

            serverHealth = new ServerHealthSampler(this);
            serverHealth.start();

            if (platformService == null) {
                // Fail closed: never run unlimited protection when the licence client
                // itself failed to initialise, unless the owner disabled it explicitly.
                licenseGated = true;
                getLogger().severe("Platform licensing could not start, so protection is DISABLED "
                        + "(fail-closed). Fix platform.yml, or set enabled: false to opt out explicitly.");
                logStartupSummary();
            } else if (platformService.requiresLicense()) {
                licenseGated = true;
                getLogger().warning("Licensing is enforced: protection is DISABLED until this server is activated.");
                getLogger().warning("Run /aegishider license link, open the portal, enter the code, "
                        + "then /aegishider license refresh.");
                logStartupSummary();
            } else {
                enableProtection();
            }
        } catch (Throwable throwable) {
            // Fail closed: never leave a half-initialised security system running.
            getLogger().log(Level.SEVERE, "Aegishider failed to enable - disabling plugin "
                    + "(no visibility data will be sent)", throwable);
            getServer().getPluginManager().disablePlugin(this);
        }
    }

    /**
     * Starts the packet gateway, listeners, discovery and the security tick. Called on
     * enable when licensing is not enforced, or once a signed licence lease is verified.
     */
    private synchronized void enableProtection() {
        if (protectionStarted || !isEnabled()) {
            return;
        }
        if (licenseGated && (platformService == null || !platformService.protectionAllowed())) {
            // Independent gate: even if a caller reaches this method directly, protection
            // cannot start without a live/cached signed lease inside its grace window.
            getLogger().warning("Protection start blocked: no valid license lease.");
            return;
        }
        try {
            if (getConfig().getBoolean("security.anti-debug", true)
                    && !getConfig().getBoolean("security.allow-debug", false)
                    && SecuritySelfCheck.debuggerOrAgentDetected()) {
                // Advisory, not a kill switch: disabling protection here would silently
                // expose every base on hosts that legitimately attach an APM profiler.
                getLogger().warning("Debugger or JVM instrumentation agent detected. "
                        + "Protection continues (advisory only); report this host if unexpected. "
                        + "Set security.allow-debug: true to silence this warning.");
                if (platformService != null) {
                    platformService.recordEvent("security.debug_agent_detected", "warning",
                            "debugger or JVM agent detected at startup", java.util.Map.of());
                }
            }
            protectionStarted = true;
            packetGateway.start();
            refreshBlockProtectionState();

            // Each listener is registered explicitly (the v3 bug registered only the outer
            // event container, leaving place/break/join/quit/world handlers dead).
            registerListener(new BlockListener(this));
            registerListener(new PlayerListener(this));
            registerListener(new ChunkListener(this));
            registerListener(new EntityListener(this));
            registerListener(new WorldListener(this));
            blockDiscovery.setSweepListener(this::onChunkSwept);

            // Everything already loaded must be protected before any packet is sent again.
            for (Player player : getServer().getOnlinePlayers()) {
                ViewerSession session = sessions.create(player, 0);
                session.updateEye(player.getEyeLocation());
                session.setBypass(player.hasPermission(config.world(player.getWorld().getName())
                        .bypassPermission()));
                itemShield.onViewerJoin(session);
                blockShield.onViewerJoin(session);
                itemShield.sweepChunkRadius(player, 4);
                blockDiscovery.enqueueAround(player.getWorld(),
                        player.getLocation().getBlockX() >> 4,
                        player.getLocation().getBlockZ() >> 4, 8);
            }
            blockDiscovery.enqueueAllLoaded(getServer().getWorlds());

            getServer().getScheduler().runTaskTimer(this, this::securityTick, 1L, 1L);
            scheduleRuntimeWarmup();
            diagnosticsExporter.start();
            logStartupSummary();
            getLogger().info("Protection ENABLED" + (licenseGated ? " (licence activated)." : "."));
        } catch (Throwable throwable) {
            protectionStarted = false;
            getLogger().log(Level.SEVERE,
                    "Failed to enable Aegishider protection; disabling the plugin", throwable);
            getServer().getPluginManager().disablePlugin(this);
        }
    }

    /** Called by the platform client on the main thread after a lease verifies. */
    public void onLicenseActivated() {
        if (!isEnabled() || !licenseGated || protectionStarted) {
            return;
        }
        if (getServer().isPrimaryThread()) {
            enableProtection();
        } else {
            getServer().getScheduler().runTask(this, this::enableProtection);
        }
    }

    /** Called after a signed lease expires beyond its offline grace window. */
    public void onLicenseExpired() {
        if (!isEnabled() || !protectionStarted) {
            return;
        }
        Runnable disable = () -> {
            if (!isEnabled() || !protectionStarted) {
                return;
            }
            getLogger().severe("License expired beyond the offline grace. Disabling Aegishider; "
                    + "reconnect this server to the platform, then run /aegishider license refresh.");
            getServer().getPluginManager().disablePlugin(this);
        };
        if (getServer().isPrimaryThread()) {
            disable.run();
        } else {
            getServer().getScheduler().runTask(this, disable);
        }
    }

    public boolean protectionStarted() {
        return protectionStarted;
    }

    public boolean licenseGated() {
        return licenseGated;
    }

    private void registerListener(Listener listener) {
        getServer().getPluginManager().registerEvents(listener, this);
        registeredListeners.add(listener);
    }

    @Override
    public void onDisable() {
        if (platformService != null) {
            platformService.stop();
        }
        if (serverHealth != null) {
            serverHealth.stop();
        }
        try {
            if (getServer().getScheduler() != null) {
                getServer().getScheduler().cancelTasks(this);
            }
        } catch (Throwable ignored) {
            // Server shutting down: scheduler may already be closed.
        }
        if (diagnosticsExporter != null) {
            diagnosticsExporter.stop();
        }
        if (packetGateway != null) {
            packetGateway.shutdown();
        }
        if (asyncPool != null) {
            asyncPool.close();
        }
        if (blockShield != null) {
            blockShield.clear();
        }
        if (tunnelShield != null) {
            tunnelShield.clear();
        }
        if (playerShield != null) {
            try {
                playerShield.shutdownRestoreVisibility();
            } catch (Throwable throwable) {
                getLogger().log(Level.WARNING, "Failed to restore player visibility on disable", throwable);
            }
        }
        if (itemShield != null) {
            // Put every entity back to normal visibility so a reload/disable does not
            // leave stuck invisible entities.
            try {
                itemShield.shutdownRestoreVisibility();
            } catch (Throwable throwable) {
                getLogger().log(Level.WARNING, "Failed to restore entity visibility on disable", throwable);
            }
        }
        registeredListeners.clear();
        getLogger().info("Aegishider " + getPluginMeta().getVersion() + " disabled.");
    }

    // ── Tick ───────────────────────────────────────────────────────────────

    private void securityTick() {
        AegishiderConfig current = config;
        tickCounter++;
        long startNanos = System.nanoTime();
        long cpuStartNanos = cpuNanos();
        try {
            // Second, independent licence gate: PlatformService also checks every five
            // minutes, but this surface runs every five seconds so a lease that expires
            // beyond its grace cannot keep protecting indefinitely.
            if (licenseGated && platformService != null && tickCounter % 100 == 0
                    && !platformService.protectionAllowed()) {
                onLicenseExpired();
            }
            // The raycast budget is per tick (see RaycastBudget and config.yml). It must
            // be restored every tick; resetting it once per second silently reduced the
            // documented 180 rays/tick to 180 rays/second, which starved block, item and
            // mob visibility under load and made nearby objects appear fake.
            raycastBudget.reset(current.raycastBudgetPerTick());
            if (tickCounter % 20 == 0) {
                // Some spawn paths (commands, other plugins) do not surface a spawn
                // event before the entity tracker packet. Re-scan loaded entities near
                // players once per second and register anything we missed.
                for (Player player : getServer().getOnlinePlayers()) {
                    itemShield.sweepNearbyEntities(player, 64.0);
                }
            }
            if (packetGateway != null) {
                packetGateway.drainDetectedBlockPositions();
                packetGateway.drainPendingEntityRegistrations();
            }
            double budgetMs = current.mainThreadBudgetMs();
            // Engine budgets deliberately add up to 90% of the tick budget: the remaining
            // 10% pays for the reconciliation slice below, so the tick never plans to
            // spend more than its own budget.
            // 35 + 40 + 15 = 90% of the configured budget; the last 10% covers the
            // reconciliation slice. The player shield used to get 7.5%, which let a
            // 50-player sweep fall several ticks behind and kept stale hides around.
            itemShield.tick(TimeBudget.ofMillis(budgetMs * 0.35), tickCounter);
            blockShield.tick(TimeBudget.ofMillis(budgetMs * 0.40), tickCounter);
            playerShield.tick(TimeBudget.ofMillis(budgetMs * 0.15));
            tunnelShield.tick(TimeBudget.ofMillis(budgetMs * 0.075));

            // Process a small slice of the discovery queue every tick so reconciliation
            // never spikes the main thread; enqueue/rescan once per second below.
            processReconciliation();
            processYShieldRefreshes();
            if (tickCounter % 20 == 0) {
                refreshViewerSessions();
                packetGateway.resendDroppedChunks();
                checkGatewayHealth();
            }
            if (tickCounter % 40 == 0) {
                refreshGauges();
            }
        } catch (Throwable throwable) {
            // Engines keep their fail-closed state; the scheduler keeps running.
            metrics.recordInternalError();
            getLogger().log(Level.SEVERE,
                    "Security tick failed (protected data remains hidden)", throwable);
        } finally {
            long wallElapsed = System.nanoTime() - startNanos;
            long cpuElapsed = cpuNanos() - cpuStartNanos;
            long measuredElapsed = cpuElapsed > 0 ? cpuElapsed : wallElapsed;
            long budgetNanos = (long) (current.mainThreadBudgetMs() * 1_000_000.0);
            metrics.recordTick(measuredElapsed, budgetNanos);
            if (measuredElapsed > budgetNanos * 2 && current.debug().logBudgetOverruns()) {
                long now = System.currentTimeMillis();
                if (now - lastBudgetWarnMs > 10_000) {
                    lastBudgetWarnMs = now;
                    getLogger().warning("Aegishider CPU work took " + (measuredElapsed / 1000)
                            + " us (wall " + (wallElapsed / 1000) + " us, budget "
                            + (budgetNanos / 1000) + " us); visibility work is being deferred");
                }
            }
        }
    }

    private void refreshViewerSessions() {
        for (ViewerSession session : sessions.all()) {
            Player player = session.player();
            if (player == null || !player.isOnline()) {
                continue;
            }
            session.setWorld(player.getWorld());
            session.updateTransform(player.getLocation(), tickCounter);
            session.updateEye(player.getEyeLocation());
            WorldSettings settings = config.world(player.getWorld().getName());
            boolean yMasked = settings.yShield().masksViewer(session.eyeY());
            if (session.yShieldMasked() != yMasked) {
                session.setYShieldMasked(yMasked);
                if (!session.bypass()) {
                    queueYShieldRefresh(player);
                }
            }
            boolean bypass = player.hasPermission(settings.bypassPermission());
            if (session.bypass() != bypass) {
                session.setBypass(bypass);
                itemShield.onViewerMoved(session, true, true);
                blockShield.onViewerBypassChanged(session);
                if (!bypass) {
                    // The bypass client may be holding unsanitized chunks from before the
                    // permission change. Re-send every chunk, including shared ones: a
                    // stale real chunk is a leak, and this path is rare (permission loss).
                    queueYShieldRefresh(player, true);
                }
            }
        }
    }

    /** Re-evaluates the Y-shield state for one viewer and refreshes chunks on a crossing. */
    public void updateYShieldState(Player player) {
        if (player == null || !player.isOnline()) {
            return;
        }
        ViewerSession session = sessions.get(player.getUniqueId());
        if (session == null) {
            return;
        }
        WorldSettings settings = config.world(player.getWorld().getName());
        boolean yMasked = settings.yShield().masksViewer(session.eyeY());
        if (session.yShieldMasked() == yMasked) {
            return;
        }
        session.setYShieldMasked(yMasked);
        if (!session.bypass()) {
            queueYShieldRefresh(player);
        }
    }

    /** Queues a full view-distance chunk re-send for one viewer after a Y-shield crossing. */
    public void queueYShieldRefresh(Player player) {
        queueYShieldRefresh(player, false);
    }

    /**
     * @param forceShared also refresh chunks that have other viewers. Used when a bypass
     *                    is revoked: those clients may still hold unsanitized chunks.
     */
    public void queueYShieldRefresh(Player player, boolean forceShared) {
        if (player == null || !player.isOnline()) {
            return;
        }
        UUID playerId = player.getUniqueId();
        int radius = Math.max(1, Math.min(getServer().getViewDistance(), 12));
        Location location = player.getLocation();
        List<ChunkRefreshPlan.Step> steps = ChunkRefreshPlan.centerOut(
                location.getBlockX() >> 4, location.getBlockZ() >> 4, radius);
        // The queue keeps a forced bypass-revocation job alive when a normal Y-crossing
        // arrives; a plain removeIf(playerId) would silently weaken that re-send.
        yShieldRefreshes.enqueue(playerId, forceShared,
                new ChunkRefreshJob(WorldKeys.idOf(player.getWorld()), steps));
    }

    private void processYShieldRefreshes() {
        for (int processed = 0; processed < Y_SHIELD_REFRESH_PER_TICK; processed++) {
            YShieldRefreshQueue.Job<ChunkRefreshJob> refresh = yShieldRefreshes.poll();
            if (refresh == null) {
                return;
            }
            Player player = getServer().getPlayer(refresh.playerId());
            ChunkRefreshJob job = refresh.payload();
            if (player == null || !player.isOnline()
                    || WorldKeys.idOf(player.getWorld()) != job.worldId()) {
                continue;
            }
            if (refresh.index() >= job.steps().size()) {
                continue;
            }
            ChunkRefreshPlan.Step step = job.steps().get(refresh.index());
            try {
                if (player.getWorld().isChunkLoaded(step.chunkX(), step.chunkZ())) {
                    refreshChunkForViewer(player, step, refresh.forceShared());
                }
            } catch (RuntimeException exception) {
                // A failed refresh keeps the client's previous (masked) copy, which is the
                // fail-closed direction; the next crossing or world change will retry.
                getLogger().log(Level.FINE, "Y-shield chunk refresh failed: "
                        + exception.getMessage());
            }
            int next = refresh.index() + 1;
            if (next < job.steps().size()) {
                yShieldRefreshes.requeue(refresh.withIndex(next));
            }
        }
    }

    /**
     * Resends one chunk for the crossing player where the API allows it. The player's
     * own 3x3 area is collision-critical and is refreshed even when shared; every farther
     * chunk is refreshed only when this player is its sole viewer, so one player's Y
     * crossing no longer blasts the whole view distance at every nearby player.
     */
    private void refreshChunkForViewer(Player viewer, ChunkRefreshPlan.Step step,
                                       boolean forceShared) {
        World world = viewer.getWorld();
        long chunkKey = Chunk.getChunkKey(step.chunkX(), step.chunkZ());
        if (!viewer.isChunkSent(chunkKey)) {
            return;
        }
        int viewers = 0;
        for (Player other : world.getPlayers()) {
            if (other.isChunkSent(chunkKey)) {
                viewers++;
                if (viewers > 1) {
                    break;
                }
            }
        }
        if (forceShared || viewers <= 1 || step.distanceSq() <= 4) {
            world.refreshChunk(step.chunkX(), step.chunkZ());
        }
    }

    /**
     * Operational watchdog: warns (once per episode) when block protection is active and
     * viewers are online but the gateway has seen no chunk/block packet for 5 minutes, or
     * when the packet-detected position bridge overflows its bound. Both indicate a
     * configuration/version problem rather than a normal idle server; neither changes the
     * fail-closed packet behaviour.
     */
    private void checkGatewayHealth() {
        if (gatewayWatchdog == null || packetGateway == null) {
            return;
        }
        long signature = metrics.chunkPacketsSanitized()
                + metrics.chunkPacketsPassed()
                + metrics.chunkPacketsBlockedFailClosed()
                + metrics.blockChangesFaked()
                + metrics.blockEntityPacketsBlocked()
                + metrics.blockActionPacketsBlocked()
                + metrics.itemSpawnPacketsBlocked()
                + metrics.packetsObserved();
        GatewayWatchdog.Event event = gatewayWatchdog.update(System.currentTimeMillis(), signature,
                sessions.size(), blockProtectionActive, packetGateway.detectedOverflowCount());
        if (event == GatewayWatchdog.Event.STALE_ACTIVITY) {
            getLogger().severe("Packet gateway has processed no chunk/block packets for "
                    + (gatewayWatchdog.silentForMs(System.currentTimeMillis()) / 1000)
                    + "s while block protection is active and players are online. Check that "
                    + "PacketEvents " + "is installed/enabled and listeners are registered; block "
                    + "protection may be ineffective (fail-closed chunk/block data is still not "
                    + "sent, but verify in /aegishider diag).");
            alertAdmins("§c[Aegishider] §ePacket gateway appears inactive while players are online - "
                    + "check PacketEvents (see console).");
        } else if (event == GatewayWatchdog.Event.DETECTED_OVERFLOW) {
            getLogger().severe("Packet-detected protected-block bridge overflowed ("
                    + packetGateway.detectedOverflowCount() + " dropped entries). Chunk data is "
                    + "still sanitized; block updates for the dropped positions may be delayed "
                    + "until reconciliation runs.");
            alertAdmins("§c[Aegishider] §eDetected-block bridge overflow - see console.");
        }
    }

    private void processReconciliation() {
        Collection<? extends Player> online = getServer().getOnlinePlayers();
        if (online.isEmpty()) {
            blockDiscovery.processQueue(2);
            return;
        }
        List<Player> players = new ArrayList<>(online);
        Player sample = players.get(reconcilePlayerCursor % players.size());
        WorldSettings settings = config.world(sample.getWorld().getName());
        int perTick = Math.max(1, settings.blockProtection().reconcileChunksPerSecond() / 20);
        blockDiscovery.processQueue(perTick);
        if (tickCounter % 20 != 0) {
            return;
        }
        reconcilePlayerCursor = (reconcilePlayerCursor + 1) % players.size();
        Player player = players.get(reconcilePlayerCursor);
        settings = config.world(player.getWorld().getName());
        // Only enqueue when the queue is not backing up: the sweep is a safety net and must
        // never build an unbounded backlog (which would delay reconciliation forever).
        if (blockDiscovery.pendingCount() < 64) {
            if (settings.blocksEnabled() && settings.blockProtection().reconcileEnabled()) {
                blockDiscovery.enqueueAround(player.getWorld(),
                        player.getLocation().getBlockX() >> 4,
                        player.getLocation().getBlockZ() >> 4,
                        Math.min(8, settings.blockProtection().reconcilePlayerRadiusChunks()));
            }
        }
    }

    private void refreshGauges() {
        metrics.setHiddenBlockCount(hiddenBlockIndex.totalBlockCount());
        metrics.setSensitiveChunkCount(hiddenBlockIndex.totalChunkCount());
        metrics.setTrackedItemCount(itemShield.trackedCount());
        metrics.setRevealedItemViewerPairs(itemShield.revealedPairCount());
        hiddenBlockIndex.pruneTombstones(System.currentTimeMillis());
        metrics.setOnlineSessions(sessions.size());
    }

    /**
     * Called after a chunk sweep changed the protected block set (startup, reconciliation,
     * reload). Clients that already have the chunk must be updated: newly protected blocks
     * get the filler, blocks that stopped being protected get their real data back.
     */
    private void onChunkSwept(World world, Chunk chunk, long[] before, long[] after) {
        itemShield.sweepChunk(chunk);
        List<Long> added = new ArrayList<>(4);
        List<Long> removed = new ArrayList<>(4);
        diffSorted(before, after, added, removed);
        if (added.isEmpty() && removed.isEmpty()) {
            // One-time contextual filler correction: chunk packets sent before discovery used
            // the fallback; push the chosen filler to clients that already received the chunk.
            long worldIdForFillers = WorldKeys.idOf(world);
            long paperChunkKeyForFillers = Chunk.getChunkKey(chunk.getX(), chunk.getZ());
            long[] positions = after == null ? new long[0] : after;
            for (Player player : world.getPlayers()) {
                ViewerSession session = sessions.get(player.getUniqueId());
                if (session == null || session.worldId() != worldIdForFillers || session.bypass()
                        || !player.isChunkSent(paperChunkKeyForFillers)) {
                    continue;
                }
                WorldSettings settings = config.world(world.getName());
                for (long pos : positions) {
                    if (blockVisibility.isRevealed(player.getUniqueId(), pos)) {
                        continue;
                    }
                    Material material = hiddenBlockIndex.filler(worldIdForFillers, pos,
                            settings.blockProtection().replaceWith());
                    player.sendBlockChange(locationOf(world, pos), blockShield.fillerFor(material));
                }
            }
            return;
        }
        long worldId = WorldKeys.idOf(world);
        long chunkKey = BlockPosUtil.chunkKey(worldId, chunk.getX(), chunk.getZ());
        long paperChunkKey = Chunk.getChunkKey(chunk.getX(), chunk.getZ());
        for (Player player : world.getPlayers()) {
            ViewerSession session = sessions.get(player.getUniqueId());
            if (session == null || session.worldId() != worldId || session.bypass()) {
                continue;
            }
            if (!player.isChunkSent(paperChunkKey)) {
                continue;
            }
            WorldSettings settings = config.world(world.getName());
            for (long pos : added) {
                if (blockVisibility.isRevealed(player.getUniqueId(), pos)) {
                    continue;
                }
                Material material = hiddenBlockIndex.filler(worldId, pos,
                        settings.blockProtection().replaceWith());
                player.sendBlockChange(locationOf(world, pos), blockShield.fillerFor(material));
            }
            for (long pos : removed) {
                blockVisibility.markHidden(player.getUniqueId(), pos);
                Location location = locationOf(world, pos);
                player.sendBlockChange(location, world.getBlockAt(location).getBlockData());
            }
        }
        // Line-of-sight caches changed for viewers near this chunk.
        blockShield.onHiddenSetChanged();
        metrics.setHiddenBlockCount(hiddenBlockIndex.totalBlockCount());
        metrics.setSensitiveChunkCount(hiddenBlockIndex.totalChunkCount());
    }

    private static Location locationOf(World world, long pos) {
        return new Location(world, BlockPosUtil.decodeX(pos), BlockPosUtil.decodeY(pos),
                BlockPosUtil.decodeZ(pos));
    }

    private static void diffSorted(long[] before, long[] after, List<Long> added, List<Long> removed) {
        int i = 0;
        int j = 0;
        int beforeLength = before == null ? 0 : before.length;
        int afterLength = after == null ? 0 : after.length;
        while (i < beforeLength || j < afterLength) {
            if (j >= afterLength) {
                removed.add(before[i++]);
            } else if (i >= beforeLength) {
                added.add(after[j++]);
            } else if (before[i] == after[j]) {
                i++;
                j++;
            } else if (before[i] < after[j]) {
                removed.add(before[i++]);
            } else {
                added.add(after[j++]);
            }
        }
    }

    /**
     * Pre-warms the expensive classes used by the visibility path (Paper's voxel ray trace,
     * FOV math, config/material resolution) shortly after worlds become available, so the
     * first player/item evaluation does not pay a multi-hundred-millisecond JIT/class-load
     * bill on the main thread while players are online.
     *
     * <p>This is a one-shot, bounded warm-up. It never reveals or hides anything and it is
     * skipped when no world is loaded yet.
     */
    private void scheduleRuntimeWarmup() {
        final int[] attempts = {0};
        final org.bukkit.scheduler.BukkitTask[] holder = new org.bukkit.scheduler.BukkitTask[1];
        holder[0] = getServer().getScheduler().runTaskTimer(this, () -> {
            attempts[0]++;
            boolean warmed = warmupRuntimeOnce();
            if (warmed || attempts[0] >= 60) {
                if (holder[0] != null) {
                    holder[0].cancel();
                }
            }
        }, 20L, 20L);
    }

    private boolean warmupRuntimeOnce() {
        try {
            java.util.List<World> worlds = getServer().getWorlds();
            if (worlds.isEmpty()) {
                return false;
            }
            for (World world : worlds) {
                Location eye = world.getSpawnLocation().clone().add(0.5, 1.62, 0.5);
                Vec3Probe.warmRayTrace(world, eye);
            }
            // Exercise the pure policy code paths once (no entities/blocks involved).
            dev.audismp.aegishider.occlusion.OcclusionEngine.insideFov(0, 0, 0, 1, 0, 0, 5, 3, 2, 0.5);
            for (String name : new String[]{"chest", "barrel", "spawner", "stone", "air"}) {
                dev.audismp.aegishider.packet.PacketMaterialCache.normalize(name);
            }
            if (!packetWarmupDone && packetGateway != null) {
                int resolved = packetGateway.warmupMaterialMappings();
                packetWarmupDone = true;
                if (config.debug().verboseErrors() && resolved > 0) {
                    getLogger().info("Warmed " + resolved + " packet material mappings");
                }
            }
            return true;
        } catch (Throwable throwable) {
            if (config.debug().verboseErrors()) {
                getLogger().warning("Runtime warmup skipped: " + throwable);
            }
            return false;
        }
    }

    /** Small helper so the warmup does not allocate in the class initialiser path. */
    private static final class Vec3Probe {
        static void warmRayTrace(World world, Location eye) {
            org.bukkit.util.RayTraceResult result = world.rayTraceBlocks(eye,
                    new org.bukkit.util.Vector(0.0, -1.0, 0.0), 8.0,
                    org.bukkit.FluidCollisionMode.SOURCE_ONLY, true);
            if (result != null) {
                result.getHitBlock();
                result.getHitPosition();
            }
            world.getMinHeight();
        }
    }

    // ── Commands side helpers ──────────────────────────────────────────────

    void loadConfig(long revision) {
        reloadConfig();
        Map<String, World.Environment> environments = new java.util.HashMap<>();
        for (World world : getServer().getWorlds()) {
            environments.put(world.getName(), world.getEnvironment());
        }
        AegishiderConfig loaded = ConfigLoader.load(getConfig(), revision, environments);
        this.config = loaded;
        for (String warning : loaded.warnings()) {
            getLogger().warning("Config: " + warning);
            if (metrics != null) {
                metrics.recordConfigWarning();
            }
        }
    }

    private void refreshBlockProtectionState() {
        boolean wantBlocks = config.anyBlockProtectionEnabled();
        boolean gatewayActive = packetGateway != null && packetGateway.isActive();
        blockProtectionActive = wantBlocks && gatewayActive;
        if (wantBlocks && !gatewayActive) {
            getLogger().severe("Block/container protection is CONFIGURED but the packet gateway is "
                    + "NOT ACTIVE: block protection is disabled (fail-closed).");
        }
    }

    boolean isBlockProtectionActive() {
        return blockProtectionActive;
    }

    /**
     * Admin rescan: re-discovers loaded chunks around players on the main thread, strictly
     * time-boxed to one tick budget. Anything left in the queue is drained by the normal
     * per-tick reconciliation slice instead of stalling the server.
     */
    public int rescanLoadedChunks(int maxChunks) {
        blockDiscovery.enqueueAllLoaded(getServer().getWorlds());
        for (Player player : getServer().getOnlinePlayers()) {
            WorldSettings settings = config.world(player.getWorld().getName());
            if (settings.blocksEnabled()) {
                blockDiscovery.enqueueAround(player.getWorld(),
                        player.getLocation().getBlockX() >> 4,
                        player.getLocation().getBlockZ() >> 4,
                        Math.min(8, settings.blockProtection().reconcilePlayerRadiusChunks()));
            }
        }
        int processed = 0;
        int batch;
        long deadlineNanos = System.nanoTime()
                + (long) (Math.max(1.0, config.mainThreadBudgetMs()) * 1_000_000.0);
        while (processed < maxChunks && System.nanoTime() < deadlineNanos
                && (batch = blockDiscovery.processQueue(64)) > 0) {
            processed += batch;
        }
        refreshGauges();
        return processed;
    }

    /** Full reload: config, block index rescan, item re-registration, packet caches. */
    public void reloadEverything() {
        getLogger().info("Reloading Aegishider...");
        configRevision++;
        // Snapshot the protected set so blocks that stop being protected can be un-faked.
        Map<Long, long[]> oldPositions = hiddenBlockIndex.snapshotByWorld();
        loadConfig(configRevision);
        raycastBudget.reset(config.raycastBudgetPerTick());
        packetGateway.reconfigure();
        // PacketEvents may have been installed after startup; start() is idempotent and
        // turns block protection on without requiring a full server restart.
        packetGateway.start();
        refreshBlockProtectionState();
        blockShield.reconfigure();
        itemShield.reconfigure();
        if (playerShield != null) {
            playerShield.shutdownRestoreVisibility();
        }
        // Config may add new hidden entity types (e.g. monsters). Existing entities in
        // already-loaded chunks must be registered + hidden immediately, not only when the
        // chunk happens to be rescanned later.
        for (Player player : getServer().getOnlinePlayers()) {
            itemShield.sweepChunkRadius(player, 4);
        }

        // Re-discover every loaded chunk (adds newly configured blocks, removes stale ones);
        // the sweep listener sends the deltas to clients that already have those chunks.
        blockDiscovery.clearQueue();
        blockDiscovery.enqueueAllLoaded(getServer().getWorlds());
        for (Player player : getServer().getOnlinePlayers()) {
            ViewerSession session = sessions.get(player.getUniqueId());
            if (session != null) {
                session.setWorld(player.getWorld());
                session.setBypass(player.hasPermission(config.world(player.getWorld().getName())
                        .bypassPermission()));
            }
        }
        if (!oldPositions.isEmpty() && !config.anyBlockProtectionEnabled()) {
            // Block protection switched off entirely: restore all old blocks now.
            revealPositionsToViewers(oldPositions);
        }
        getLogger().info("Aegishider reloaded (config revision " + configRevision
                + ", block protection " + (blockProtectionActive ? "ACTIVE" : "INACTIVE") + ")");
    }

    private void revealPositionsToViewers(Map<Long, long[]> positionsByWorld) {
        for (Player player : getServer().getOnlinePlayers()) {
            ViewerSession session = sessions.get(player.getUniqueId());
            if (session == null) {
                continue;
            }
            World world = player.getWorld();
            // Only restore positions that belong to the player's own world; positions are
            // raw x/y/z, so applying another world's list would leak coordinates/block data.
            long[] positions = positionsByWorld.get(WorldKeys.idOf(world));
            if (positions == null) {
                continue;
            }
            int sent = 0;
            for (long pos : positions) {
                int cx = BlockPosUtil.decodeX(pos) >> 4;
                int cz = BlockPosUtil.decodeZ(pos) >> 4;
                if (!player.isChunkSent(Chunk.getChunkKey(cx, cz))) {
                    continue;
                }
                blockVisibility.markHidden(player.getUniqueId(), pos);
                Location location = locationOf(world, pos);
                player.sendBlockChange(location, world.getBlockAt(location).getBlockData());
                if (++sent >= 4096) {
                    break;
                }
            }
        }
    }

    public void recordMining(BlockBreakEvent event) {
        AegishiderConfig.MiningSettings settings = config.mining();
        if (!settings.enabled()) {
            return;
        }
        var suspicious = miningAnalytics.recordMine(event.getPlayer().getUniqueId(), settings,
                event.getBlock().getType(), event.getBlock().getX(), event.getBlock().getY(),
                event.getBlock().getZ());
        if (suspicious.suspicious()) {
            alertAdmins("§c[Aegishider] §eMining anomaly: §f" + event.getPlayer().getName()
                    + (suspicious.tunnel()
                    ? " §7tunnel streak=" + suspicious.tunnelStreak()
                    : " §7ores=" + String.format("%.1f%%", suspicious.orePercent())));
        }
    }

    public void alertAdmins(String message) {
        for (Player player : getServer().getOnlinePlayers()) {
            if (player.hasPermission("aegishider.admin")) {
                player.sendMessage(message);
            }
        }
    }

    /**
     * Runs non-security diagnostics off the main thread. Used only by /aegishider diag deep.
     * Never used for visibility decisions.
     */
    public void runAsyncDiagnostics(Consumer<List<String>> callback) {
        BoundedTaskExecutor pool = asyncPool;
        if (pool == null) {
            callback.accept(List.of("async pool not available"));
            return;
        }
        boolean accepted = pool.submit(() -> {
            List<String> lines = new ArrayList<>();
            try {
                lines.add("index worlds=" + hiddenBlockIndex.worldCount()
                        + " blocks=" + hiddenBlockIndex.totalBlockCount()
                        + " chunks=" + hiddenBlockIndex.totalChunkCount());
                lines.add("async submitted=" + pool.submitted() + " completed=" + pool.completed()
                        + " rejected=" + pool.rejected() + " queue=" + pool.queueSize() + "/"
                        + pool.queueCapacity());
                lines.add("session count=" + sessions.size());
            } catch (Throwable throwable) {
                lines.add("async diagnostics failed: " + throwable);
            }
            List<String> result = List.copyOf(lines);
            getServer().getScheduler().runTask(this, () -> callback.accept(result));
        });
        if (!accepted) {
            callback.accept(List.of("async queue saturated: deep diagnostics skipped "
                    + "(security path unaffected)"));
        }
    }

    /** Runtime self-check for /aegishider verify. Main thread. */
    public List<String> verify() {
        List<String> problems = new ArrayList<>();
        if (packetGateway == null || !packetGateway.isActive()) {
            if (config.anyBlockProtectionEnabled()) {
                problems.add("block protection configured but packet gateway is "
                        + (packetGateway == null ? "missing" : packetGateway.statusLine()));
            }
        }
        problems.addAll(itemShield.verify());
        problems.addAll(blockShield.verify());
        Set<String> registeredClasses = new HashSet<>();
        for (var registered : HandlerList.getRegisteredListeners(this)) {
            registeredClasses.add(registered.getListener().getClass().getName());
        }
        for (Class<?> expected : List.of(BlockListener.class, PlayerListener.class,
                ChunkListener.class, EntityListener.class, WorldListener.class)) {
            if (!registeredClasses.contains(expected.getName())) {
                problems.add("listener not registered: " + expected.getSimpleName());
            }
        }
        for (Player player : getServer().getOnlinePlayers()) {
            if (sessions.get(player.getUniqueId()) == null) {
                problems.add("missing viewer session for " + player.getName());
            }
        }
        return problems;
    }

    private void logStartupSummary() {
        long disabledHidden = hiddenBlockIndex.totalBlockCount();
        getLogger().info("Aegishider " + getPluginMeta().getVersion() + " enabled | worlds=" + config.worlds().size()
                + " | packet-gateway=" + packetGateway.statusLine()
                + " | protection=" + (protectionStarted ? "ACTIVE" : "WAITING_FOR_LICENSE")
                + " | block-protection=" + (blockProtectionActive ? "ACTIVE" : "INACTIVE")
                + " | item-protection=" + (protectionStarted && config.anyItemProtectionEnabled()
                        ? "ACTIVE" : "INACTIVE")
                + " | known-protected-blocks=" + disabledHidden
                + " | build=" + BuildInfo.target() + " (" + BuildInfo.paperApi() + ")"
                + " | async-threads=" + metrics.asyncThreads());
        if (!config.warnings().isEmpty()) {
            getLogger().warning(config.warnings().size()
                    + " configuration warnings; run /aegishider status after fixing config.yml");
        }
    }

    // ── Getters used by components ─────────────────────────────────────────

    public static AegishiderPlugin getInstance() { return instance; }
    public AegishiderConfig config() { return config; }
    public Metrics metrics() { return metrics; }
    public SessionRegistry sessions() { return sessions; }
    public HiddenBlockIndex hiddenBlockIndex() { return hiddenBlockIndex; }
    public BlockVisibility blockVisibility() { return blockVisibility; }
    public BlockDiscovery blockDiscovery() { return blockDiscovery; }
    public ItemShield itemShield() { return itemShield; }

    public PlayerShield playerShield() { return playerShield; }

    public TunnelShield tunnelShield() { return tunnelShield; }

    public OcclusionEngine occlusionEngine() { return occlusionEngine; }
    public BlockShield blockShield() { return blockShield; }
    public PacketGateway packetGateway() { return packetGateway; }
    public RaycastBudget raycastBudget() { return raycastBudget; }
    public MiningAnalytics miningAnalytics() { return miningAnalytics; }
    public RaidAnalytics raidAnalytics() { return raidAnalytics; }
    public boolean blockProtectionActive() { return blockProtectionActive; }
    public long blockProtectionActiveLong() { return blockProtectionActive ? 1L : 0L; }
    public int currentTick() { return tickCounter; }
    public long configRevision() { return configRevision; }
    public BoundedTaskExecutor asyncPool() { return asyncPool; }
    public PlatformService platformService() { return platformService; }
    public ServerHealthSampler serverHealth() { return serverHealth; }

    public GatewayWatchdog gatewayWatchdog() { return gatewayWatchdog; }

    public DiagnosticsExporter diagnosticsExporter() { return diagnosticsExporter; }
    private static long cpuNanos() {
        try {
            return Math.max(0L, THREAD_BEAN.getCurrentThreadCpuTime());
        } catch (RuntimeException ignored) {
            return 0L;
        }
    }

}
