package dev.audismp.aegishider.packet;

import com.github.retrooper.packetevents.PacketEvents;
import com.github.retrooper.packetevents.PacketEventsAPI;
import com.github.retrooper.packetevents.event.PacketListenerAbstract;
import com.github.retrooper.packetevents.event.PacketListenerCommon;
import com.github.retrooper.packetevents.event.PacketListenerPriority;
import com.github.retrooper.packetevents.event.PacketSendEvent;
import com.github.retrooper.packetevents.manager.server.ServerVersion;
import com.github.retrooper.packetevents.netty.NettyManager;
import com.github.retrooper.packetevents.netty.buffer.ByteBufOperator;
import com.github.retrooper.packetevents.protocol.packettype.PacketType;
import com.github.retrooper.packetevents.protocol.packettype.PacketTypeCommon;
import com.github.retrooper.packetevents.protocol.player.ClientVersion;
import com.github.retrooper.packetevents.protocol.player.User;
import com.github.retrooper.packetevents.protocol.world.chunk.Column;
import com.github.retrooper.packetevents.protocol.world.chunk.BaseChunk;
import com.github.retrooper.packetevents.protocol.world.chunk.impl.v_1_18.Chunk_v1_18;
import com.github.retrooper.packetevents.protocol.world.chunk.palette.DataPalette;
import com.github.retrooper.packetevents.protocol.world.chunk.palette.PaletteType;
import com.github.retrooper.packetevents.protocol.world.chunk.palette.SingletonPalette;
import com.github.retrooper.packetevents.protocol.world.chunk.TileEntity;
import com.github.retrooper.packetevents.util.PEVersion;
import com.github.retrooper.packetevents.wrapper.play.server.WrapperPlayServerBlockChange;
import com.github.retrooper.packetevents.wrapper.play.server.WrapperPlayServerChunkData;
import com.github.retrooper.packetevents.wrapper.play.server.WrapperPlayServerMultiBlockChange;
import dev.audismp.aegishider.AegishiderPlugin;
import dev.audismp.aegishider.config.AegishiderConfig;
import dev.audismp.aegishider.config.WorldSettings;
import dev.audismp.aegishider.core.BlockVisibility;
import dev.audismp.aegishider.core.SessionRegistry;
import dev.audismp.aegishider.core.ViewerSession;
import dev.audismp.aegishider.core.WorldKeys;
import dev.audismp.aegishider.index.HiddenBlockIndex;
import dev.audismp.aegishider.item.ItemShield;
import dev.audismp.aegishider.metrics.Metrics;
import dev.audismp.aegishider.util.BlockPosUtil;
import org.bukkit.Material;
import org.bukkit.entity.Player;

import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.logging.Level;

/**
 * PacketEvents implementation of the packet security gateway.
 *
 * <p>Every handler runs on the Netty thread and is treated as untrusted/error-prone:
 * <ul>
 *   <li>it only reads concurrent snapshots and never touches Bukkit world objects;</li>
 *   <li>any exception in a packet category that can carry protected data results in the
 *       packet being CANCELLED (fail-closed) and counted;</li>
 *   <li>the fast paths never parse a packet: the chunk position / block position / entity
 *       id are peeked directly from the byte buffer without moving the reader index.</li>
 * </ul>
 *
 * <p>Costs: chunk packets of non-sensitive chunks are a single concurrent-map lookup;
 * sensitive chunks (a chunk containing at least one protected block) are rewritten with
 * cost O(protected blocks), not O(chunk volume).
 */
public final class PacketEventsGateway implements PacketGateway {

    private static final long PEEK_FAILED = Long.MIN_VALUE;
    private static final long ERROR_LOG_INTERVAL_MS = 10_000L;
    private static final int  WORLD_CACHE_SOFT_LIMIT = 256;

    private final AegishiderPlugin plugin;
    private final Metrics metrics;
    private final SessionRegistry sessions;
    private final HiddenBlockIndex index;
    private final BlockVisibility blockVisibility;
    private final ItemShield itemShield;
    private final ChunkSanitizer.StateIdMapper stateIdMapper = new PacketMaterialCache();
    private final PacketMaterialCache materialCache = new PacketMaterialCache();

    private final ConcurrentHashMap<String, WorldHidden> worldHiddenCache = new ConcurrentHashMap<>();
    private final DetectedProtectedBlocks detectedProtectedBlocks = new DetectedProtectedBlocks();
    private final AtomicLong lastErrorLogMs = new AtomicLong();
    private final ConcurrentHashMap<Integer, BaseChunk> yFillerSections = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<UUID, ConcurrentHashMap<Long, Integer>> pendingChunkResends = new ConcurrentHashMap<>();
    private final java.util.concurrent.ConcurrentLinkedQueue<PendingEntityRegistration> pendingEntityRegistrations =
            new java.util.concurrent.ConcurrentLinkedQueue<>();
    private record PendingEntityRegistration(UUID uuid, long worldId) {
    }

    private volatile ByteBufOperator bufferOperator;
    private volatile PacketListenerCommon listener;
    private volatile State state = State.NOT_STARTED;
    private volatile ClientVersion protocolVersion = ClientVersion.V_1_21_4;
    private volatile String statusDetail = "not started";
    private long configRevision = -1L;

    private record WorldHidden(Set<String> typeNames, Set<String> tileEntityTypeNames,
                               Set<String> stateOnlyNames, Material filler,
                               dev.audismp.aegishider.config.WorldSettings.YShield yShield,
                               dev.audismp.aegishider.config.WorldSettings.TunnelShield tunnelShield) {
    }

    public PacketEventsGateway(AegishiderPlugin plugin, Metrics metrics, SessionRegistry sessions,
                               HiddenBlockIndex index, BlockVisibility blockVisibility,
                               ItemShield itemShield) {
        this.plugin = plugin;
        this.metrics = metrics;
        this.sessions = sessions;
        this.index = index;
        this.blockVisibility = blockVisibility;
        this.itemShield = itemShield;
    }

    // ── Startup / shutdown ─────────────────────────────────────────────────

    /**
     * Registers the outgoing packet listener. Must be called after the PacketEvents plugin
     * has initialised (PacketEvents is a soft dependency and loads first).
     *
     * @return true when the gateway is active
     */
    @Override
    public boolean start() {
        if (state == State.ACTIVE) {
            return true;
        }
        try {
            PacketEventsAPI<?> api = PacketEvents.getAPI();
            if (api == null) {
                return unavailable("PacketEvents API not initialised");
            }
            if (!api.isLoaded() || !api.isInitialized()) {
                return unavailable("PacketEvents is not loaded/initialised");
            }
            ServerVersion serverVersion = api.getServerManager().getVersion();
            if (!isSupportedServerVersion(serverVersion)) {
                return unavailable("server version " + serverVersion
                        + " is not supported by this build (requires Paper 1.21.1 - 1.21.11)");
            }
            this.protocolVersion = serverVersion.toClientVersion();
            if (plugin.tunnelShield() != null) {
                plugin.tunnelShield().setProtocolVersion(protocolVersion);
            }
            String minimum = plugin.config().packetGateway().minimumVersion();
            PEVersion currentVersion = api.getVersion();
            PEVersion requiredVersion = PEVersion.fromString(minimum);
            if (currentVersion == null || currentVersion.isOlderThan(requiredVersion)) {
                return unavailable("PacketEvents " + (currentVersion == null ? "?" : currentVersion)
                        + " is older than required " + minimum);
            }
            NettyManager nettyManager = api.getNettyManager();
            if (nettyManager == null) {
                return unavailable("PacketEvents netty manager unavailable");
            }
            this.bufferOperator = nettyManager.getByteBufOperator();
            if (this.bufferOperator == null) {
                return unavailable("PacketEvents byte-buffer operator unavailable");
            }
            configRevision = plugin.config().revision();
            PacketListenerAbstract packetListener =
                    new PacketListenerAbstract(PacketListenerPriority.HIGHEST) {
                        @Override
                        public void onPacketSend(PacketSendEvent event) {
                            handleSend(event);
                        }
                    };
            this.listener = api.getEventManager().registerListener(packetListener);
            this.state = State.ACTIVE;
            this.statusDetail = "PacketEvents " + currentVersion + " active on " + serverVersion;
            plugin.getLogger().info("Packet gateway ACTIVE: " + statusDetail);
            return true;
        } catch (Throwable throwable) {
            return unavailable("packet gateway start failed: " + throwable);
        }
    }

    private boolean unavailable(String reason) {
        state = State.UNAVAILABLE;
        statusDetail = reason;
        plugin.getLogger().severe("Packet gateway UNAVAILABLE: " + reason);
        plugin.getLogger().severe("Block/container protection is DISABLED (fail-closed policy: "
                + "Aegishider will not send real blocks first and patch them later).");
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
        return state + " (" + statusDetail + ")";
    }

    @Override
    public void shutdown() {
        pendingChunkResends.clear();
        PacketListenerCommon current = listener;
        listener = null;
        if (current != null) {
            try {
                PacketEventsAPI<?> api = PacketEvents.getAPI();
                if (api != null) {
                    api.getEventManager().unregisterListener(current);
                }
            } catch (Throwable throwable) {
                plugin.getLogger().log(Level.WARNING, "Failed to unregister packet listener", throwable);
            }
        }
        state = State.NOT_STARTED;
    }

    @Override
    public void reconfigure() {
        materialCache.clear();
        worldHiddenCache.clear();
        configRevision = plugin.config().revision();
    }

    @Override
    public int warmupMaterialMappings() {
        AegishiderConfig config = plugin.config();
        Set<String> bareNames = new HashSet<>();
        Set<Material> fillers = new HashSet<>();
        for (WorldSettings settings : config.worlds().values()) {
            if (!settings.blocksEnabled()) {
                continue;
            }
            for (Material material : settings.blockProtection().hiddenMaterials()) {
                bareNames.add(material.name().toLowerCase(Locale.ROOT));
            }
            fillers.add(settings.blockProtection().replaceWith());
        }
        if (bareNames.isEmpty()) {
            return 0;
        }
        try {
            return materialCache.warmup(ClientVersion.V_1_21_4, bareNames, fillers);
        } catch (RuntimeException ex) {
            metrics.recordInternalError();
            plugin.getLogger().log(Level.WARNING,
                    "Packet-layer material warmup failed; lazy resolution will be used", ex);
            return 0;
        }
    }

    @Override
    public String clientVersion(org.bukkit.entity.Player player) {
        try {
            ClientVersion version = PacketEvents.getAPI().getPlayerManager().getClientVersion(player);
            return version == null ? "unknown" : version.name();
        } catch (RuntimeException ex) {
            return "unknown";
        }
    }

    private void queueChunkResend(UUID viewerId, long worldId, int chunkX, int chunkZ) {
        if (viewerId == null) {
            return;
        }
        if (pendingChunkResends.size() > 256) {
            return;
        }
        ConcurrentHashMap<Long, Integer> chunks =
                pendingChunkResends.computeIfAbsent(viewerId, id -> new ConcurrentHashMap<>());
        if (chunks.size() > 32) {
            return;
        }
        long key = BlockPosUtil.chunkKey(worldId, chunkX, chunkZ);
        chunks.compute(key, (ignored, attempts) -> attempts == null ? 1 : Math.min(3, attempts + 1));
    }

    @Override
    public int resendDroppedChunks() {
        if (pendingChunkResends.isEmpty()) {
            return 0;
        }
        int requested = 0;
        for (UUID viewerId : pendingChunkResends.keySet()) {
            org.bukkit.entity.Player player = plugin.getServer().getPlayer(viewerId);
            ConcurrentHashMap<Long, Integer> chunks = pendingChunkResends.get(viewerId);
            if (player == null || !player.isOnline() || chunks == null) {
                pendingChunkResends.remove(viewerId);
                continue;
            }
            long currentWorld = dev.audismp.aegishider.core.WorldKeys.idOf(player.getWorld());
            for (Long key : chunks.keySet()) {
                Integer attempts = chunks.get(key);
                if (attempts == null || attempts <= 0) {
                    chunks.remove(key);
                    continue;
                }
                if (BlockPosUtil.worldIdOfChunkKey(key) != currentWorld) {
                    chunks.remove(key);
                    continue;
                }
                try {
                    player.getWorld().refreshChunk(BlockPosUtil.chunkXOf(key), BlockPosUtil.chunkZOf(key));
                    requested++;
                } catch (RuntimeException exception) {
                    plugin.getLogger().log(java.util.logging.Level.FINE,
                            "Chunk resend failed: " + exception.getMessage());
                }
                chunks.compute(key, (ignored, value) -> value == null || value <= 1 ? null : value - 1);
            }
            if (chunks.isEmpty()) {
                pendingChunkResends.remove(viewerId);
            }
        }
        return requested;
    }

    public int detectedPendingCount() {
        return detectedProtectedBlocks.trackedPositions();
    }

    @Override
    public long detectedOverflowCount() {
        return detectedProtectedBlocks.overflowCount();
    }

    @Override
    public void drainDetectedBlockPositions() {
        // Runs on the main thread: register detected positions immediately (fail-closed) and
        // schedule a real discovery to reconcile/remove them if the blocks changed.
        for (var entry : detectedProtectedBlocks.drain()) {
            long worldId = entry.getKey();
            long[] positions = entry.getValue();
            java.util.UUID worldUuid = WorldKeys.uuidOf(worldId);
            org.bukkit.World world = worldUuid == null ? null : plugin.getServer().getWorld(worldUuid);
            for (long pos : positions) {
                index.register(worldId, pos);
            }
            if (world != null) {
                for (long pos : positions) {
                    plugin.blockDiscovery().enqueue(world,
                            BlockPosUtil.decodeX(pos) >> 4, BlockPosUtil.decodeZ(pos) >> 4);
                }
            }
        }
    }

    @Override
    public void drainPendingEntityRegistrations() {
        PendingEntityRegistration pending;
        while ((pending = pendingEntityRegistrations.poll()) != null) {
            org.bukkit.entity.Entity entity = plugin.getServer().getEntity(pending.uuid());
            if (entity == null || WorldKeys.idOf(entity.getWorld()) != pending.worldId()) {
                continue;
            }
            itemShield.onEntityAvailable(entity);
        }
    }

    @Override
    public String diagnostics() {
        return "state=" + state
                + " chunkSanitized=" + metrics.chunkPacketsSanitized()
                + " chunkFailClosed=" + metrics.chunkPacketsBlockedFailClosed()
                + " blockFaked=" + metrics.blockChangesFaked()
                + " itemSpawnBlocked=" + metrics.itemSpawnPacketsBlocked()
                + " entityChosenPacketsCancelled=" + metrics.entityPacketsCancelled()
                + " earlyEntitySpawnBlocked=" + metrics.earlyEntitySpawnBlocked()
                + " yShieldSections=" + metrics.yShieldSections()
                + " tunnelMasked=" + metrics.tunnelBlocksMasked()
                + " tunnelTracked=" + (plugin.tunnelShield() == null ? 0 : plugin.tunnelShield().trackedCount())
                + " errors=" + metrics.internalErrors()
                + " packetDetectedBlocks=" + detectedProtectedBlocks.trackedPositions()
                + " packetDetectedOverflow=" + detectedProtectedBlocks.overflowCount();
    }

    // ── Outgoing packet dispatch ───────────────────────────────────────────

    private void handleSend(PacketSendEvent event) {
        metrics.recordPacketObserved();
        PacketTypeCommon type = event.getPacketType();
        if (type == null) {
            return;
        }
        try {
            if (type == PacketType.Play.Server.CHUNK_DATA) {
                handleChunkData(event);
            } else if (type == PacketType.Play.Server.BLOCK_CHANGE) {
                handleBlockChange(event);
            } else if (type == PacketType.Play.Server.MULTI_BLOCK_CHANGE) {
                handleMultiBlockChange(event);
            } else if (type == PacketType.Play.Server.BLOCK_ENTITY_DATA
                    || type == PacketType.Play.Server.BLOCK_ACTION) {
                handleBlockPositionPacket(event, type == PacketType.Play.Server.BLOCK_ENTITY_DATA);
            } else if (type == PacketType.Play.Server.BLOCK_BREAK_ANIMATION) {
                handleBlockBreakAnimation(event);
            } else if (isEntityIdPacket(type)) {
                handleEntityPacket(event, type);
            }
        } catch (Throwable throwable) {
            onHandlerError(event, type, throwable);
        }
    }

    private void onHandlerError(PacketSendEvent event, PacketTypeCommon type, Throwable throwable) {
        metrics.recordInternalError();
        // Fail-closed: a packet category that may carry protected block/entity data is
        // dropped rather than forwarded unverified.
        event.setCancelled(true);
        long now = System.currentTimeMillis();
        long last = lastErrorLogMs.get();
        if (now - last >= ERROR_LOG_INTERVAL_MS && lastErrorLogMs.compareAndSet(last, now)) {
            plugin.getLogger().log(Level.SEVERE, "Packet gateway handler error for " + type
                    + " - packet cancelled (fail-closed). Further errors in this window are counted only.",
                    plugin.config().debug().verboseErrors() ? throwable : null);
        }
    }

    // ── Chunk data ─────────────────────────────────────────────────────────

    private void handleChunkData(PacketSendEvent event) {
        UUID viewerId = viewerId(event);
        if (viewerId == null) {
            event.setCancelled(true);
            metrics.recordChunkFailClosed();
            return;
        }
        ViewerSession session = sessions.get(viewerId);
        if (session == null) {
            event.setCancelled(true);
            metrics.recordChunkFailClosed();
            return;
        }
        if (session.bypass()) {
            metrics.recordChunkPassed();
            return;
        }
        long worldId = session.worldId();
        if (worldId == WorldKeys.UNKNOWN) {
            event.setCancelled(true);
            metrics.recordChunkFailClosed();
            return;
        }
        Object buffer = event.getByteBuf();
        if (buffer == null) {
            event.setCancelled(true);
            metrics.recordChunkFailClosed();
            return;
        }
        final boolean modernChunkFormat = protocolVersion.isNewerThanOrEquals(ClientVersion.V_1_21_5);
        WrapperPlayServerChunkData earlyWrapper = null;
        Column earlyColumn = null;
        int chunkX;
        int chunkZ;
        if (modernChunkFormat) {
            // 1.21.5+ changed the chunk payload layout. Delegate it to PacketEvents instead of
            // guessing the buffer structure with raw reads.
            try {
                earlyWrapper = new WrapperPlayServerChunkData(event);
                earlyColumn = earlyWrapper.getColumn();
            } catch (RuntimeException exception) {
                earlyColumn = null;
            }
            if (earlyColumn == null) {
                event.setCancelled(true);
                metrics.recordChunkFailClosed();
                return;
            }
            chunkX = earlyColumn.getX();
            chunkZ = earlyColumn.getZ();
        } else {
            long packedCoords = peekChunkCoordinates(buffer);
            if (packedCoords == PEEK_FAILED) {
                event.setCancelled(true);
                metrics.recordChunkFailClosed();
                return;
            }
            chunkX = (int) (packedCoords >> 32);
            chunkZ = (int) packedCoords;
        }
        // A (re)sent chunk replaces the client's block data. Any reveal markers from before
        // the send are stale and must not block the reveal engine from sending the real
        // blocks again after the chunk arrives (otherwise a nearby chest stays stone).
        long sentChunkKey = BlockPosUtil.chunkKey(worldId, chunkX, chunkZ);
        blockVisibility.clearChunk(viewerId, sentChunkKey);
        blockVisibility.enqueueResync(viewerId, sentChunkKey);

        WorldHidden currentInfo = worldHidden(session.worldName());
        if (currentInfo == null) {
            // Block protection is not configured for this world.
            metrics.recordChunkPassed();
            return;
        }
        dev.audismp.aegishider.config.WorldSettings.YShield yShield = currentInfo.yShield();
        boolean yMask = yShield.masksViewer(session.eyeY())
                && yShield.masksChunk(chunkX, chunkZ, session.chunkX(), session.chunkZ());
        boolean tunnelTracked = currentInfo.tunnelShield().enabled()
                && plugin.tunnelShield() != null
                && plugin.tunnelShield().hasTunnelsInChunk(worldId, chunkX, chunkZ);
        int blockEntityCount;
        if (modernChunkFormat) {
            TileEntity[] earlyTileEntities = earlyColumn.getTileEntities();
            blockEntityCount = earlyTileEntities == null ? 0 : earlyTileEntities.length;
        } else {
            blockEntityCount = peekBlockEntityCount(buffer);
        }
        if (blockEntityCount < 0) {
            // Cannot determine whether this chunk may contain protected block-entity data:
            // fail closed rather than risk sending real container data.
            event.setCancelled(true);
            metrics.recordChunkFailClosed();
            queueChunkResend(viewerId, worldId, chunkX, chunkZ);
            return;
        }

        HiddenBlockIndex.ChunkView currentView = index.chunkView(worldId, chunkX, chunkZ);
        HiddenBlockIndex.ChunkView previousView = null;
        boolean transition = currentView == null && session.isWorldTransitionActive()
                && session.previousWorldId() != WorldKeys.UNKNOWN;
        if (transition) {
            previousView = index.chunkView(session.previousWorldId(), chunkX, chunkZ);
        }
        if (blockEntityCount == 0 && currentView == null && previousView == null && !yMask
                && !tunnelTracked && currentInfo.stateOnlyNames().isEmpty()) {
            metrics.recordChunkPassed();
            return; // fast path: no block entities and no state-scanned material configured
        }

        WorldHidden previousInfo = null;
        if (previousView != null) {
            previousInfo = worldHidden(session.previousWorldName());
            if (previousInfo == null) {
                previousView = null; // previous world no longer protects blocks: skip fallback
            }
        }
        Set<String> hiddenNames;
        Set<String> hiddenTileEntityTypes;
        Set<String> stateOnlyNames;
        Material filler;
        if (previousInfo != null) {
            hiddenNames = new HashSet<>(currentInfo.typeNames());
            hiddenNames.addAll(previousInfo.typeNames());
            hiddenTileEntityTypes = new HashSet<>(currentInfo.tileEntityTypeNames());
            hiddenTileEntityTypes.addAll(previousInfo.tileEntityTypeNames());
            stateOnlyNames = new HashSet<>(currentInfo.stateOnlyNames());
            stateOnlyNames.addAll(previousInfo.stateOnlyNames());
            filler = currentInfo.filler();
        } else {
            hiddenNames = currentInfo.typeNames();
            hiddenTileEntityTypes = currentInfo.tileEntityTypeNames();
            stateOnlyNames = currentInfo.stateOnlyNames();
            filler = currentInfo.filler();
        }

        ClientVersion clientVersion = clientVersion(event);
        if (clientVersion.isOlderThan(ClientVersion.V_1_18)) {
            // Unsupported chunk format for this client: fail closed.
            event.setCancelled(true);
            metrics.recordChunkFailClosed();
            return;
        }

        // IMPORTANT: the outgoing chunk bytes are always encoded in the SERVER protocol
        // version (1.21.1 - 1.21.11), even when the receiver is a newer client translated by
        // ViaVersion. State-id ↔ material resolution and the filler state id therefore
        // MUST use the server version, never the client version.
        final Material fallbackFiller = filler;
        WrapperPlayServerChunkData wrapper = earlyWrapper;
        Column column = earlyColumn;
        if (wrapper == null) {
            wrapper = new WrapperPlayServerChunkData(event);
            column = wrapper.getColumn();
        }
        if (column == null || column.getX() != chunkX || column.getZ() != chunkZ) {
            event.setCancelled(true);
            metrics.recordChunkFailClosed();
            queueChunkResend(viewerId, worldId, chunkX, chunkZ);
            return;
        }
        ChunkSanitizer.Result result = ChunkSanitizer.sanitize(column, protocolVersion,
                session.minSectionY(), currentView, previousView, hiddenNames, fallbackFiller,
                pos -> index.filler(worldId, pos, fallbackFiller), stateIdMapper, true,
                hiddenTileEntityTypes, stateOnlyNames);
        if (result.hasDetectedPositions()) {
            // The chunk itself proved these positions protected (stale/empty index). Keep
            // them in the packet-layer fail-closed bridge so block updates are already
            // filtered, and let the main thread register + reconcile them.
            for (long detectedPos : result.detectedPositions()) {
                detectedProtectedBlocks.add(worldId, detectedPos);
            }
        }
        if (plugin.config().debug().logBlockedPackets() && result.rewritten()) {
            plugin.getLogger().info("Chunk sanitize: client=" + clientVersion
                    + " chunk=" + chunkX + "," + chunkZ
                    + " changed=" + result.changedBlocks()
                    + " detected=" + result.detectedPositions().length
                    + " tileEntitiesRemoved=" + (result.tileEntities() != null)
                    + " stateScanMs=" + (result.stateScan().elapsedNanos() / 1_000_000.0)
                    + " stateScanSections=" + result.stateScan().sectionsVisited()
                    + " stateScanPrefiltered=" + result.stateScan().sectionsPrefiltered()
                    + " stateScanBlocksRead=" + result.stateScan().blocksRead());
        }
        int tunnelMasked = 0;
        if (plugin.tunnelShield() != null && currentInfo.tunnelShield().enabled()) {
            Player tunnelViewer = session.player();
            if (tunnelViewer != null) {
                tunnelMasked = plugin.tunnelShield().maskColumn(column, tunnelViewer, worldId,
                        chunkX, chunkZ, session.minSectionY(), currentInfo.tunnelShield());
            }
        }
        int ySectionsMasked = 0;
        TileEntity[] yFilteredTileEntities = null;
        if (yMask) {
            // Y-shield wins over Tunnel Shield: the whole volume below the line is filler
            // for this viewer, including cave rooms whose containers were already hidden.
            // Tunnel Shield runs first above, then this pass overwrites its real blocks.
            int fillerId = stateIdMapper.fillerStateId(protocolVersion, yShield.filler());
            if (fillerId <= 0) {
                // Cannot resolve a safe filler: never send the real underground.
                event.setCancelled(true);
                metrics.recordChunkFailClosed();
                queueChunkResend(viewerId, worldId, chunkX, chunkZ);
                return;
            }
            ySectionsMasked = ChunkSanitizer.maskBelowY(column, session.minSectionY(),
                    yShield.hideBelowY(), fillerId, yFillerSection(fillerId));
            // Filter the ALREADY sanitized list. Starting from column.getTileEntities()
            // would re-introduce hidden container/sign block entities above the line that
            // ChunkSanitizer just removed.
            TileEntity[] sanitizedTileEntities = result.tileEntities() != null
                    ? result.tileEntities() : column.getTileEntities();
            if (sanitizedTileEntities != null && sanitizedTileEntities.length > 0) {
                java.util.List<TileEntity> kept = new java.util.ArrayList<>(sanitizedTileEntities.length);
                for (TileEntity tileEntity : sanitizedTileEntities) {
                    if (tileEntity != null && tileEntity.getYShort() < yShield.hideBelowY()) {
                        continue;
                    }
                    if (tileEntity != null) {
                        kept.add(tileEntity);
                    }
                }
                if (kept.size() != sanitizedTileEntities.length) {
                    yFilteredTileEntities = kept.toArray(new TileEntity[0]);
                }
            }
        }
        TileEntity[] finalTileEntities = yFilteredTileEntities != null ? yFilteredTileEntities
                : result.tileEntities() != null ? result.tileEntities() : column.getTileEntities();
        if (!result.rewritten() && ySectionsMasked == 0 && yFilteredTileEntities == null
                && tunnelMasked == 0) {
            metrics.recordChunkPassed();
            return;
        }
        if (finalTileEntities != column.getTileEntities()) {
            wrapper.setColumn(new Column(column.getX(), column.getZ(), column.isFullChunk(),
                    column.getChunks(), finalTileEntities, column.getHeightmaps()));
        }
        event.markForReEncode(true);
        for (int i = 0; i < ySectionsMasked; i++) {
            metrics.recordYShieldSection();
        }
        // The client now holds filler for every protected block in this chunk: drop reveal
        // markers for it. The main thread re-evaluates visible blocks on the next ticks.
        blockVisibility.enqueueResync(viewerId, BlockPosUtil.chunkKey(worldId, chunkX, chunkZ));
        metrics.recordChunkSanitized();
    }

    /** Cached all-filler section prototype used by the Y-level shield. */
    private BaseChunk yFillerSection(int fillerStateId) {
        return yFillerSections.computeIfAbsent(fillerStateId, id -> {
            BaseChunk section = BaseChunk.create();
            for (int y = 0; y < 16; y++) {
                for (int x = 0; x < 16; x++) {
                    for (int z = 0; z < 16; z++) {
                        section.set(x, y, z, id);
                    }
                }
            }
            return section;
        });
    }

    // ── Block packets ──────────────────────────────────────────────────────

    private void handleBlockChange(PacketSendEvent event) {
        PacketContext context = packetContext(event);
        if (context == null) {
            event.setCancelled(true);
            return;
        }
        if (context.session().bypass()) {
            return;
        }
        WorldHidden info = worldHidden(context.session().worldName());
        if (info == null) {
            // Block protection is not configured for this world. Pass the packet through:
            // cancelling here froze every block update (containers, animations, breaking)
            // in worlds that deliberately opt out.
            return;
        }
        Object buffer = event.getByteBuf();
        if (buffer == null) {
            event.setCancelled(true);
            return;
        }
        long packedPosition = peekLong(buffer);
        if (packedPosition == PEEK_FAILED) {
            event.setCancelled(true);
            return;
        }
        int x = unpackBlockX(packedPosition);
        int y = unpackBlockY(packedPosition);
        int z = unpackBlockZ(packedPosition);
        long blockPos = BlockPosUtil.encode(x, y, z);
        int stateId = peekVarIntAfterLong(buffer);
        if (stateId < 0) {
            event.setCancelled(true);
            return;
        }
        WorldSettings.YShield yShield = info.yShield();
        if (yShield.masksBlock(context.session().eyeY(), y)) {
            int fillerId = materialCache.fillerStateId(protocolVersion, yShield.filler());
            if (fillerId <= 0) {
                event.setCancelled(true);
                return;
            }
            WrapperPlayServerBlockChange wrapper = new WrapperPlayServerBlockChange(event);
            wrapper.setBlockID(fillerId);
            event.markForReEncode(true);
            metrics.recordBlockChangeFaked();
            return;
        }
        long worldId = context.session().worldId();
        if (plugin.tunnelShield() != null && info.tunnelShield().enabled()) {
            Player viewer = context.session().player();
            int tunnelState = viewer == null ? -1 : plugin.tunnelShield().maskBlockUpdate(
                    worldId, blockPos, stateId, viewer, info.tunnelShield());
            if (tunnelState >= 0) {
                WrapperPlayServerBlockChange wrapper = new WrapperPlayServerBlockChange(event);
                wrapper.setBlockID(tunnelState);
                event.markForReEncode(true);
                return;
            }
        }
        // Air means the block was removed. Re-sending a filler here creates a ghost
        // block that "comes back" every time a player breaks a hidden container.
        // Tunnel Shield masks its own air updates above; protected containers must
        // be allowed to vanish.
        if (stateId == 0) {
            return;
        }
        // The index can lag behind blocks placed by commands/plugins/WorldEdit. A block
        // update whose state is a configured protected material must be filtered even
        // before the main thread registers the position: otherwise the client learns the
        // exact container position at any distance for one tick.
        boolean indexed = isProtectedBlock(worldId, blockPos);
        String typeName = materialCache.typeName(protocolVersion, stateId);
        boolean hiddenType = typeName != null && info.typeNames().contains(typeName);
        if (!indexed && !hiddenType) {
            return; // unprotected position and unprotected type: fast path
        }
        if (blockVisibility.isRevealed(context.viewerId(), blockPos)) {
            return;
        }
        if (!indexed && hiddenType) {
            // A command/plugin placed a protected block without firing Bukkit events.
            // Remember it so the main thread can index it (state-only blocks such as a
            // bookshelf have no block entity for discovery to find).
            detectedProtectedBlocks.add(worldId, blockPos);
        }
        if (indexed && typeName != null && !hiddenType && stateId != 0) {
            return; // a known protected position became a real non-container block
        }
        WrapperPlayServerBlockChange wrapper = new WrapperPlayServerBlockChange(event);
        wrapper.setBlockID(materialCache.fillerStateId(protocolVersion,
                index.filler(worldId, blockPos, info.filler())));
        event.markForReEncode(true);
        metrics.recordBlockChangeFaked();
    }

    private void handleMultiBlockChange(PacketSendEvent event) {
        PacketContext context = packetContext(event);
        if (context == null) {
            event.setCancelled(true);
            return;
        }
        if (context.session().bypass()) {
            return;
        }
        WorldHidden info = worldHidden(context.session().worldName());
        if (info == null) {
            // Block protection is not configured for this world. Pass the packet through:
            // cancelling here froze every block update (containers, animations, breaking)
            // in worlds that deliberately opt out.
            return;
        }
        WrapperPlayServerMultiBlockChange wrapper = new WrapperPlayServerMultiBlockChange(event);
        WrapperPlayServerMultiBlockChange.EncodedBlock[] blocks = wrapper.getBlocks();
        if (blocks == null || blocks.length == 0) {
            return;
        }
        boolean changed = false;
        WorldSettings.YShield yShield = info.yShield();
        for (WrapperPlayServerMultiBlockChange.EncodedBlock block : blocks) {
            long blockPos = BlockPosUtil.encode(block.getX(), block.getY(), block.getZ());
            if (yShield.masksBlock(context.session().eyeY(), block.getY())) {
                int fillerId = materialCache.fillerStateId(protocolVersion, yShield.filler());
                if (fillerId <= 0) {
                    event.setCancelled(true);
                    return;
                }
                block.setBlockId(fillerId);
                changed = true;
                continue;
            }
            if (plugin.tunnelShield() != null && info.tunnelShield().enabled()) {
                Player viewer = context.session().player();
                int tunnelState = viewer == null ? -1 : plugin.tunnelShield().maskBlockUpdate(
                        context.session().worldId(), blockPos, block.getBlockId(), viewer,
                        info.tunnelShield());
                if (tunnelState >= 0) {
                    block.setBlockId(tunnelState);
                    changed = true;
                    continue;
                }
            }
            long worldId = context.session().worldId();
            // Air is a removal; never resurrect it as a filler (ghost blocks).
            if (block.getBlockId() == 0) {
                continue;
            }
            // Same fail-closed rule as BLOCK_CHANGE: a protected material at an
            // unindexed position (command/plugin placement) must not leak through.
            boolean indexed = isProtectedBlock(worldId, blockPos);
            String typeName = materialCache.typeName(protocolVersion, block.getBlockId());
            boolean hiddenType = typeName != null && info.typeNames().contains(typeName);
            if (!indexed && !hiddenType) {
                continue;
            }
            if (blockVisibility.isRevealed(context.viewerId(), blockPos)) {
                continue;
            }
            if (!indexed && hiddenType) {
                detectedProtectedBlocks.add(context.session().worldId(), blockPos);
            }
            if (indexed && typeName != null && !hiddenType && block.getBlockId() != 0) {
                continue; // a known protected position became a real non-container block
            }
            block.setBlockId(materialCache.fillerStateId(protocolVersion,
                    index.filler(worldId, blockPos, info.filler())));
            changed = true;
        }
        if (changed) {
            event.markForReEncode(true);
            metrics.recordBlockChangeFaked();
        }
    }

    private void handleBlockPositionPacket(PacketSendEvent event, boolean blockEntityData) {
        PacketContext context = packetContext(event);
        if (context == null) {
            event.setCancelled(true);
            return;
        }
        if (context.session().bypass()) {
            return;
        }
        WorldHidden info = worldHidden(context.session().worldName());
        if (info == null) {
            // Block protection is not configured for this world. Pass the packet through:
            // cancelling here froze every block update (containers, animations, breaking)
            // in worlds that deliberately opt out.
            return;
        }
        Object buffer = event.getByteBuf();
        if (buffer == null) {
            event.setCancelled(true);
            return;
        }
        long packedPosition = peekLong(buffer);
        if (packedPosition == PEEK_FAILED) {
            event.setCancelled(true);
            return;
        }
        int blockY = unpackBlockY(packedPosition);
        long blockPos = BlockPosUtil.encode(unpackBlockX(packedPosition),
                blockY, unpackBlockZ(packedPosition));
        if (info.yShield().masksBlock(context.session().eyeY(), blockY)) {
            // Chest/container NBT, note-block/chest animations and other block actions
            // below the line would announce the hidden room even though its blocks are
            // filler. Suppress them for surface viewers.
            event.setCancelled(true);
            metrics.recordBlockEntityBlocked();
            return;
        }
        if (!isProtectedBlock(context.session().worldId(), blockPos)) {
            // Same lagging-index rule as block updates: BLOCK_ENTITY_DATA whose payload
            // type is a protected tile entity must die even at unregistered positions,
            // otherwise a command-placed chest announces its NBT (and location) early.
            if (!blockEntityData || !isHiddenTileEntityPayload(buffer, info)) {
                return;
            }
        }
        if (blockVisibility.isRevealed(context.viewerId(), blockPos)) {
            return;
        }
        event.setCancelled(true);
        metrics.recordBlockEntityBlocked();
    }

    /**
     * Peeks the tile-entity type id that follows the packed block position in
     * BLOCK_ENTITY_DATA. Only a positive match against configured hidden types is
     * treated as protected; unknown ids fail open to keep signs/banners working.
     */
    private boolean isHiddenTileEntityPayload(Object buffer, WorldHidden info) {
        if (info.tileEntityTypeNames().isEmpty()) {
            return false;
        }
        int typeId = peekVarIntAfterLong(buffer);
        if (typeId < 0) {
            return true; // malformed payload at a protected-type packet: fail closed
        }
        String typeName = materialCache.tileEntityTypeName(protocolVersion, typeId);
        return typeName != null && info.tileEntityTypeNames().contains(typeName);
    }

    private void handleBlockBreakAnimation(PacketSendEvent event) {
        PacketContext context = packetContext(event);
        if (context == null) {
            event.setCancelled(true);
            return;
        }
        if (context.session().bypass()) {
            return;
        }
        Object buffer = event.getByteBuf();
        if (buffer == null) {
            event.setCancelled(true);
            return;
        }
        long position = peekVarIntAndLong(buffer);
        if (position == PEEK_FAILED) {
            event.setCancelled(true);
            return;
        }
        int breakY = unpackBlockY(position);
        long blockPos = BlockPosUtil.encode(unpackBlockX(position),
                breakY, unpackBlockZ(position));
        WorldHidden info = worldHidden(context.session().worldName());
        if (info != null && info.yShield().masksBlock(context.session().eyeY(), breakY)) {
            event.setCancelled(true);
            metrics.recordBlockActionBlocked();
            return;
        }
        if (!isProtectedBlock(context.session().worldId(), blockPos)) {
            return;
        }
        if (blockVisibility.isRevealed(context.viewerId(), blockPos)) {
            return;
        }
        event.setCancelled(true);
        metrics.recordBlockActionBlocked();
    }

    // ── Entity packets (defence in depth for native entity visibility) ─────

    private static boolean isEntityIdPacket(PacketTypeCommon type) {
        return type == PacketType.Play.Server.ENTITY_METADATA
                || type == PacketType.Play.Server.ENTITY_RELATIVE_MOVE
                || type == PacketType.Play.Server.ENTITY_RELATIVE_MOVE_AND_ROTATION
                || type == PacketType.Play.Server.ENTITY_ROTATION
                || type == PacketType.Play.Server.ENTITY_TELEPORT
                || type == PacketType.Play.Server.ENTITY_VELOCITY
                || type == PacketType.Play.Server.ENTITY_HEAD_LOOK
                || type == PacketType.Play.Server.ENTITY_ANIMATION
                || type == PacketType.Play.Server.ENTITY_STATUS
                || type == PacketType.Play.Server.ENTITY_EQUIPMENT
                || type == PacketType.Play.Server.ENTITY_POSITION_SYNC
                || type == PacketType.Play.Server.COLLECT_ITEM
                || type == PacketType.Play.Server.SPAWN_ENTITY;
    }

    private void handleEntityPacket(PacketSendEvent event, PacketTypeCommon type) {
        if (!plugin.config().anyItemProtectionEnabled()) {
            return; // entity protection disabled everywhere: zero overhead
        }
        Object buffer = event.getByteBuf();
        if (buffer == null) {
            return;
        }
        UUID viewerId = viewerId(event);
        if (viewerId == null) {
            return;
        }
        ViewerSession session = sessions.get(viewerId);
        if (session == null || session.bypass()) {
            return;
        }
        boolean spawn = type == PacketType.Play.Server.SPAWN_ENTITY;
        com.github.retrooper.packetevents.protocol.entity.type.EntityType spawnType = null;
        UUID spawnUuid = null;
        int entityId;
        if (spawn) {
            // PacketEvents decodes the spawn layout for the actual server version; raw peeks
            // break on 1.21.5+ and on translated clients.
            try {
                var spawnWrapper = new com.github.retrooper.packetevents.wrapper.play.server
                        .WrapperPlayServerSpawnEntity(event);
                entityId = spawnWrapper.getEntityId();
                spawnType = spawnWrapper.getEntityType();
                spawnUuid = spawnWrapper.getUUID().orElse(null);
            } catch (RuntimeException exception) {
                event.setCancelled(true);
                return;
            }
        } else {
            entityId = peekVarInt(buffer);
            if (entityId < 0) {
                return;
            }
        }

        ItemShield.TrackedEntity tracked = itemShield.trackedByEntityId(entityId);
        if (tracked != null && tracked.worldId() != session.worldId()) {
            tracked = null; // entity ids can be reused across worlds; never cross-match
        }
        boolean debugPackets = plugin.config().debug().logBlockedPackets();
        if (spawn) {
            String spawnTypeName = spawnType == null || spawnType.getName() == null
                    ? null : spawnType.getName().toString();
            boolean isItemSpawn = "minecraft:item".equals(spawnTypeName) || "item".equals(spawnTypeName);
            if (!isItemSpawn) {
                // Not an item entity spawn. If it reuses a tracked id, only suppress while
                // the tracked (removed) record still exists; the main thread unregisters on
                // removal events, so this is a short fail-closed window.
                boolean hiddenSpawn = tracked == null && isHiddenEntitySpawn(spawnType, session);
                if (tracked != null) {
                    if (!tracked.isRevealedTo(viewerId)) {
                        event.setCancelled(true);
                        metrics.recordEntityPacketCancelled();
                    }
                } else if (hiddenSpawn) {
                    // Race window: the server tracker can emit a spawn before the main
                    // thread registers the entity (observed for armor stands/minecarts
                    // with ViaVersion clients). Fail closed based on the packet's entity
                    // type; when the entity is registered and proven visible the reveal
                    // engine sends its spawn again.
                    event.setCancelled(true);
                    metrics.recordEntityPacketCancelled();
                    metrics.recordEarlyEntitySpawnBlocked();
                }
                if (debugPackets && (tracked != null || hiddenSpawn)) {
                    plugin.getLogger().info("Entity spawn decision: entityId=" + entityId
                            + " type=" + spawnTypeName
                            + " tracked=" + (tracked != null)
                            + " hiddenSpawn=" + hiddenSpawn
                            + " cancelled=" + event.isCancelled());
                }
                return;
            }
            if (tracked == null) {
                // An item spawn that was not registered by the main thread (typically an
                // item outside the periodic player sweep). Cancel fail-closed, but ask the
                // main thread to register it by UUID so the normal visibility engine can
                // show it instead of leaving a legitimate item permanently invisible.
                if (spawnUuid != null && pendingEntityRegistrations.size() < 256) {
                    pendingEntityRegistrations.add(new PendingEntityRegistration(
                            spawnUuid, session.worldId()));
                }
                event.setCancelled(true);
                metrics.recordUnexpectedItemSpawnBlocked();
                warnUnexpectedItemSpawn(entityId);
                return;
            }
            if (tracked.isRevealedTo(viewerId)) {
                if (debugPackets) {
                    plugin.getLogger().info("Item spawn decision: entityId=" + entityId
                            + " revealed=true cancelled=false");
                }
                return;
            }
            event.setCancelled(true);
            metrics.recordItemSpawnBlocked();
            metrics.recordEntityPacketCancelled();
            if (debugPackets) {
                plugin.getLogger().info("Item spawn decision: entityId=" + entityId
                        + " revealed=false cancelled=true");
            }
            return;
        }

        if (tracked == null) {
            return;
        }
        if (tracked.isRevealedTo(viewerId)) {
            return;
        }
        event.setCancelled(true);
        metrics.recordItemStateBlocked();
        metrics.recordEntityPacketCancelled();
    }

    private void warnUnexpectedItemSpawn(int entityId) {
        long now = System.currentTimeMillis();
        long last = lastErrorLogMs.get();
        if (now - last >= ERROR_LOG_INTERVAL_MS && lastErrorLogMs.compareAndSet(last, now)) {
            plugin.getLogger().warning("Blocked an item spawn packet for an untracked entity id "
                    + entityId + " (fail-closed). ItemShield may have missed a registration; "
                    + "the entity stays invisible to the client.");
        }
    }

    // ── Viewer / world helpers ─────────────────────────────────────────────

    private record PacketContext(UUID viewerId, ViewerSession session, ClientVersion clientVersion) {
    }

    /**
     * Outgoing chunk/block/entity packets are encoded in the SERVER protocol version (ViaVersion
     * translates afterwards). Resolve it at startup so 1.21.1 - 26.3 all use the right state ids.
     */
    private static boolean isSupportedServerVersion(ServerVersion version) {
        return version != null
                && version.ordinal() >= ServerVersion.V_1_21_1.ordinal()
                && version.ordinal() <= ServerVersion.V_26_3.ordinal();
    }

    private PacketContext packetContext(PacketSendEvent event) {
        UUID viewerId = viewerId(event);
        if (viewerId == null) {
            return null;
        }
        ViewerSession session = sessions.get(viewerId);
        if (session == null || !session.isWorldKnown()) {
            return null;
        }
        return new PacketContext(viewerId, session, protocolVersion);
    }

    private UUID viewerId(PacketSendEvent event) {
        User user = event.getUser();
        return user == null ? null : user.getUUID();
    }

    private static ClientVersion clientVersion(PacketSendEvent event) {
        User user = event.getUser();
        ClientVersion version = user == null ? null : user.getClientVersion();
        return version == null ? ClientVersion.V_1_21_4 : version;
    }

    /**
     * @return true when the spawn packet's entity type is configured as hidden for this
     *         viewer's world. Unknown type ids are treated as hidden (fail-closed).
     */
    private boolean isHiddenEntitySpawn(
            com.github.retrooper.packetevents.protocol.entity.type.EntityType entityType,
            ViewerSession session) {
        dev.audismp.aegishider.config.WorldSettings settings =
                plugin.config().world(session.worldName());
        if (!settings.itemsEnabled()) {
            return false;
        }
        try {
            if (entityType == null || entityType.getName() == null) {
                return true;
            }
            String name = entityType.getName().toString();
            if (name.startsWith("minecraft:")) {
                name = name.substring("minecraft:".length());
            }
            org.bukkit.entity.EntityType bukkitType =
                    org.bukkit.entity.EntityType.valueOf(name.toUpperCase(Locale.ROOT));
            return settings.itemProtection().isHiddenType(bukkitType);
        } catch (RuntimeException ex) {
            return true; // unknown mapping: do not risk a protected entity spawn
        }
    }

    private WorldHidden worldHidden(String worldName) {
        if (worldName == null || worldName.isEmpty()) {
            return null;
        }
        long revision = plugin.config().revision();
        if (revision != configRevision) {
            reconfigure();
        }
        String key = revision + ":" + worldName;
        WorldHidden cached = worldHiddenCache.get(key);
        if (cached != null) {
            return cached;
        }
        AegishiderConfig config = plugin.config();
        WorldSettings settings = config.world(worldName);
        if (!settings.blocksEnabled()) {
            return null;
        }
        Set<String> names = new HashSet<>(settings.blockProtection().hiddenMaterials().size() * 2);
        for (Material material : settings.blockProtection().hiddenMaterials()) {
            names.add(material.name().toLowerCase(Locale.ROOT));
        }
        WorldHidden created = new WorldHidden(Set.copyOf(names),
                dev.audismp.aegishider.util.MaterialSets.tileEntityTypeNames(
                        settings.blockProtection().hiddenMaterials()),
                dev.audismp.aegishider.util.MaterialSets.stateOnlyHiddenNames(
                        settings.blockProtection().hiddenMaterials()),
                settings.blockProtection().replaceWith(), settings.yShield(), settings.tunnelShield());
        if (worldHiddenCache.size() > WORLD_CACHE_SOFT_LIMIT) {
            worldHiddenCache.clear();
        }
        WorldHidden race = worldHiddenCache.putIfAbsent(key, created);
        return race != null ? race : created;
    }

    // ── Zero-allocation byte buffer peeking ────────────────────────────────

    private long peekChunkCoordinates(Object buffer) {
        ByteBufOperator operator = bufferOperator;
        if (operator == null) {
            return PEEK_FAILED;
        }
        operator.markReaderIndex(buffer);
        try {
            int chunkX = operator.readInt(buffer);
            int chunkZ = operator.readInt(buffer);
            return ((long) chunkX << 32) | (chunkZ & 0xFFFF_FFFFL);
        } catch (RuntimeException ex) {
            return PEEK_FAILED;
        } finally {
            operator.resetReaderIndex(buffer);
        }
    }

    /**
     * Cheaply skips the chunk coordinates (2 ints), the heightmaps NBT and the section data
     * blob, then reads the block-entity count. No chunk data is parsed or copied. Returns -1
     * when the layout cannot be followed (caller must fail closed).
     */
    private int peekBlockEntityCount(Object buffer) {
        ByteBufOperator operator = bufferOperator;
        if (operator == null) {
            return -1;
        }
        operator.markReaderIndex(buffer);
        try {
            operator.readInt(buffer); // chunkX
            operator.readInt(buffer); // chunkZ
            int heightmapLength = readVarInt(operator, buffer);
            if (heightmapLength < 0) {
                return -1;
            }
            operator.skipBytes(buffer, heightmapLength);
            int dataLength = readVarInt(operator, buffer);
            if (dataLength < 0) {
                return -1;
            }
            operator.skipBytes(buffer, dataLength);
            return readVarInt(operator, buffer);
        } catch (RuntimeException ex) {
            return -1;
        } finally {
            operator.resetReaderIndex(buffer);
        }
    }

    private long peekLong(Object buffer) {
        ByteBufOperator operator = bufferOperator;
        if (operator == null) {
            return PEEK_FAILED;
        }
        operator.markReaderIndex(buffer);
        try {
            return operator.readLong(buffer);
        } catch (RuntimeException ex) {
            return PEEK_FAILED;
        } finally {
            operator.resetReaderIndex(buffer);
        }
    }

    private int peekVarInt(Object buffer) {
        ByteBufOperator operator = bufferOperator;
        if (operator == null) {
            return -1;
        }
        operator.markReaderIndex(buffer);
        try {
            return readVarInt(operator, buffer);
        } catch (RuntimeException ex) {
            return -1;
        } finally {
            operator.resetReaderIndex(buffer);
        }
    }

    private int peekVarIntAfterLong(Object buffer) {
        ByteBufOperator operator = bufferOperator;
        if (operator == null) {
            return -1;
        }
        operator.markReaderIndex(buffer);
        try {
            operator.readLong(buffer);
            return readVarInt(operator, buffer);
        } catch (RuntimeException ex) {
            return -1;
        } finally {
            operator.resetReaderIndex(buffer);
        }
    }

    private long peekVarIntAndLong(Object buffer) {
        ByteBufOperator operator = bufferOperator;
        if (operator == null) {
            return PEEK_FAILED;
        }
        operator.markReaderIndex(buffer);
        try {
            readVarInt(operator, buffer);
            return operator.readLong(buffer);
        } catch (RuntimeException ex) {
            return PEEK_FAILED;
        } finally {
            operator.resetReaderIndex(buffer);
        }
    }

    private static int readVarInt(ByteBufOperator operator, Object buffer) {
        int value = 0;
        int position = 0;
        while (true) {
            byte current = operator.readByte(buffer);
            value |= (current & 0x7F) << position;
            if ((current & 0x80) == 0) {
                return value;
            }
            position += 7;
            if (position >= 35) {
                return -1;
            }
        }
    }

    /** Fail-closed check: indexed protected position OR position detected by the packet layer. */
    private boolean isProtectedBlock(long worldId, long blockPos) {
        return index.isHidden(worldId, blockPos)
                || detectedProtectedBlocks.contains(worldId, blockPos);
    }

    // BlockPos packing: x 26 bits << 38 | z 26 bits << 12 | y 12 bits
    private static int unpackBlockX(long packed) {
        return signExtend26((int) (packed >> 38));
    }

    private static int unpackBlockY(long packed) {
        return signExtend12((int) (packed & 0xFFF));
    }

    private static int unpackBlockZ(long packed) {
        return signExtend26((int) ((packed >> 12) & 0x3FF_FFFF));
    }

    private static int signExtend26(int value) {
        return (value & 0x200_0000) != 0 ? value | 0xFC00_0000 : value;
    }

    private static int signExtend12(int value) {
        return (value & 0x800) != 0 ? value | 0xFFFF_F000 : value;
    }
}
