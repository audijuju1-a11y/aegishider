package dev.audismp.aegishider.blocks;

import dev.audismp.aegishider.AegishiderPlugin;
import dev.audismp.aegishider.config.AegishiderConfig;
import dev.audismp.aegishider.config.WorldSettings;
import dev.audismp.aegishider.core.BlockVisibility;
import dev.audismp.aegishider.core.CandidatePlan;
import dev.audismp.aegishider.core.SessionRegistry;
import dev.audismp.aegishider.core.TimeBudget;
import dev.audismp.aegishider.core.ViewerSession;
import dev.audismp.aegishider.core.WorldKeys;
import dev.audismp.aegishider.index.HiddenBlockIndex;
import dev.audismp.aegishider.metrics.Metrics;
import dev.audismp.aegishider.occlusion.OcclusionEngine;
import dev.audismp.aegishider.util.BlockPosUtil;
import io.papermc.paper.math.Position;
import org.bukkit.Chunk;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.data.BlockData;
import org.bukkit.entity.Player;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import java.util.logging.Level;

/**
 * BlockShield - occlusion-based reveal/re-hide of protected blocks.
 *
 * <p>Protected blocks are removed from chunk data and block-change packets by the packet
 * gateway (they are never sent as real data first). This engine decides which of those
 * blocks the viewer is legitimately able to see and sends the real block back:
 *
 * <pre>
 *   candidate: hidden block inside reveal distance
 *        -> inside field of view (unless the gate is disabled with 360) ?
 *        -> ray trace from eye to block surface unobstructed ?
 *        -> send real block, remember "revealed"
 *   revealed block stays visible while close (no flicker); it is hidden again when the
 *   viewer leaves, the chunk is resent, the world changes, or the block stops existing.
 * </pre>
 *
 * <p>All work is main-thread, budgeted and sliced over ticks. If the budget is exhausted
 * the block simply stays part of the next scan; it can never be revealed without a
 * completed positive policy check.
 */
public final class BlockShield {

    private static final int MAX_CANDIDATES_PER_SCAN = 2048;
    private static final int MAX_REVEAL_CHECKS_PER_TICK = 128;
    /** First seconds after a viewer joins are spread over more ticks to avoid a join spike. */
    private static final int JOIN_RAMP_TICKS = 60;
    private static final int RAMP_CHECKS_PER_TICK = 24;
    private long maxHideNanos;
    private long maxRebuildNanos;
    private long maxEvalNanos;
    private long revealCount;
    private long skipNotSent;
    private long skipDistance;
    private long skipFov;
    private long skipBudget;
    private static final int FULL_RECHECK_INTERVAL_TICKS = 20;

    private final AegishiderPlugin plugin;
    private final Metrics metrics;
    private final SessionRegistry sessions;
    private final HiddenBlockIndex index;
    private final OcclusionEngine occlusion;
    private final BlockVisibility blockVisibility;

    private final Map<UUID, ViewerState> states = new HashMap<>(64);
    private final Map<Material, BlockData> fillerData = new HashMap<>(8);
    private final AtomicLong occlusionRevision = new AtomicLong();
    private int tickCounter;
    private int roundRobinCursor;

    public BlockShield(AegishiderPlugin plugin, Metrics metrics, SessionRegistry sessions,
                       HiddenBlockIndex index, OcclusionEngine occlusion, BlockVisibility blockVisibility) {
        this.plugin = plugin;
        this.metrics = metrics;
        this.sessions = sessions;
        this.index = index;
        this.occlusion = occlusion;
        this.blockVisibility = blockVisibility;
    }

    private static final class ViewerState {
        boolean forceDirty = true;
        long lastViewerRevision = Long.MIN_VALUE;
        long lastIndexRevision = Long.MIN_VALUE;
        long lastOcclusionRevision = Long.MIN_VALUE;
        long lastFullScanTick = Integer.MIN_VALUE;
        long[] candidates = new long[0];
        int candidateCursor;
        int chunkX = Integer.MIN_VALUE;
        int chunkZ = Integer.MIN_VALUE;
        int hiddenCandidates;
        int revealsThisScan;
        long joinTick = -1;
        int evaluationsThisTick;

        void reset() {
            forceDirty = true;
            lastViewerRevision = Long.MIN_VALUE;
            lastIndexRevision = Long.MIN_VALUE;
            lastOcclusionRevision = Long.MIN_VALUE;
            lastFullScanTick = Integer.MIN_VALUE;
            candidates = new long[0];
            candidateCursor = 0;
            joinTick = -1;
            hiddenCandidates = 0;
            revealsThisScan = 0;
        }
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────

    public void onViewerJoin(ViewerSession session) {
        blockVisibility.addViewer(session.playerId());
        ViewerState state = new ViewerState();
        state.forceDirty = true;
        states.put(session.playerId(), state);
    }

    public void onViewerQuit(UUID viewerId) {
        states.remove(viewerId);
        blockVisibility.removeViewer(viewerId);
    }

    public void onViewerWorldChanged(ViewerSession session) {
        blockVisibility.clearAll(session.playerId());
        ViewerState state = states.get(session.playerId());
        if (state != null) {
            state.reset();
        }
        if (isBypassed(session)) {
            return;
        }
        // The client got a fresh world; hidden blocks will be re-sent through chunk
        // sanitization when the new chunks arrive.
    }

    /**
     * Same-world teleport/respawn. Chunks outside the new view are dropped by the
     * server, but replay-caching clients (Bobby, Distant Horizons) keep the last
     * block state they were sent, so a revealed container must be re-hidden before
     * its marker is dropped - clearing the marker alone would leave the real block
     * in the client cache forever.
     */
    public void onViewerPositionJump(ViewerSession viewer) {
        ViewerState state = states.get(viewer.playerId());
        if (state == null) {
            return;
        }
        WorldSettings settings = plugin.config().world(viewer.player().getWorld().getName());
        if (!settings.blocksEnabled() || viewer.bypass()) {
            blockVisibility.clearAll(viewer.playerId());
            state.reset();
            return;
        }
        state.forceDirty = true;
        hideOutOfRangeReveals(viewer, state, settings,
                TimeBudget.ofMillis(Math.max(0.25, plugin.config().mainThreadBudgetMs())));
    }

    /** Any block in the world changed: line-of-sight caches are now suspect. */
    public void onOcclusionChanged(World world, int x, int y, int z) {
        occlusionRevision.incrementAndGet();
        if (plugin.itemShield() != null) {
            plugin.itemShield().onBlockChanged(world, x, y, z);
        }
    }

    public void reconfigure() {
        fillerData.clear();
        for (ViewerState state : states.values()) {
            state.reset();
        }
    }

    /** A player's bypass permission changed: reveal/restore state immediately. */
    public void onViewerBypassChanged(ViewerSession viewer) {
        blockVisibility.clearAll(viewer.playerId());
        ViewerState state = states.get(viewer.playerId());
        if (state != null) {
            state.reset();
        }
        if (viewer.bypass()) {
            // Bypass: the client must see the real world. Chunks already sent contain our
            // fillers, so send the real block for every nearby protected position.
            World world = viewer.player().getWorld();
            WorldSettings settings = plugin.config().world(world.getName());
            int radius = Math.max(1, (int) Math.ceil(settings.blockProtection().revealDistance() / 16.0));
            long worldId = viewer.worldId();
            int centerX = viewer.blockX() >> 4;
            int centerZ = viewer.blockZ() >> 4;
            for (int dx = -radius; dx <= radius; dx++) {
                for (int dz = -radius; dz <= radius; dz++) {
                    HiddenBlockIndex.ChunkView view = index.chunkView(worldId, centerX + dx, centerZ + dz);
                    if (view == null) {
                        continue;
                    }
                    for (long pos : view.positions()) {
                        Location location = new Location(world, BlockPosUtil.decodeX(pos),
                                BlockPosUtil.decodeY(pos), BlockPosUtil.decodeZ(pos));
                        viewer.player().sendBlockChange(location, world.getBlockAt(location).getBlockData());
                    }
                }
            }
        } else {
            // Bypass revoked: re-hide nearby blocks that the client still sees as real.
            state.forceDirty = true;
        }
    }

    /** The protected-block set changed: force a full re-evaluation. */
    public void onHiddenSetChanged() {
        occlusionRevision.incrementAndGet();
        for (ViewerState state : states.values()) {
            state.forceDirty = true;
        }
    }

    /** World unload: drop all reveal markers and reset viewer state. */
    public void onViewerWorldChangedForAll() {
        for (UUID viewerId : new ArrayList<>(states.keySet())) {
            blockVisibility.clearAll(viewerId);
            ViewerState state = states.get(viewerId);
            if (state != null) {
                state.reset();
            }
        }
    }

    // ── Tick ───────────────────────────────────────────────────────────────

    public void tick(TimeBudget budget, int tick) {
        long startNanos = System.nanoTime();
        tickCounter = tick;
        try {
            AegishiderConfig config = plugin.config();
            if (!config.anyBlockProtectionEnabled() || !plugin.blockProtectionActive()) {
                return;
            }
            drainResyncRequests();
            List<ViewerSession> viewers = new ArrayList<>(sessions.all());
            if (viewers.isEmpty()) {
                return;
            }
            int count = viewers.size();
            int start = roundRobinCursor % count;
            for (int i = 0; i < count; i++) {
                if (budget.expired()) {
                    break;
                }
                ViewerSession viewer = viewers.get((start + i) % count);
                processViewer(viewer, budget, config);
            }
            roundRobinCursor = (start + 1) % count;
        } catch (RuntimeException ex) {
            metrics.recordInternalError();
            plugin.getLogger().log(Level.SEVERE,
                    "BlockShield tick error (fail-closed: blocks stay hidden)", ex);
        } finally {
            metrics.recordBlockDecision(System.nanoTime() - startNanos);
        }
    }

    private void drainResyncRequests() {
        List<BlockVisibility.ResyncRequest> requests = blockVisibility.drainResync(64);
        for (BlockVisibility.ResyncRequest request : requests) {
            ViewerState state = states.get(request.viewer());
            if (state != null) {
                state.forceDirty = true;
            }
        }
    }

    private void processViewer(ViewerSession viewer, TimeBudget budget, AegishiderConfig config) {
        World world = viewer.player().getWorld();
        WorldSettings settings = config.world(world.getName());
        ViewerState state = states.computeIfAbsent(viewer.playerId(), key -> new ViewerState());
        if (!settings.blocksEnabled() || !viewer.isWorldKnown()) {
            return;
        }
        if (viewer.bypass()) {
            // Bypass viewers receive real chunk data directly; nothing to reveal/hide.
            hideAllRevealed(viewer, state);
            return;
        }

        boolean chunkChanged = state.chunkX != viewer.chunkX() || state.chunkZ != viewer.chunkZ();
        long indexRevision = index.revision();
        boolean indexChanged = state.lastIndexRevision != indexRevision;
        long currentOcclusionRevision = occlusionRevision.get();
        boolean due = state.forceDirty
                || chunkChanged
                || state.lastViewerRevision != viewer.revision()
                || indexChanged
                || state.lastOcclusionRevision != currentOcclusionRevision
                || (tickCounter - state.lastFullScanTick) >= FULL_RECHECK_INTERVAL_TICKS;
        if (!due) {
            return;
        }
        if (indexChanged) {
            // Newly discovered/removed protected blocks must be re-scanned even if the old
            // candidate list was not exhausted yet (this was why a freshly discovered chest
            // could stay stone forever: no candidate entry existed for it).
            state.candidates = new long[0];
            state.candidateCursor = 0;
        }
        state.forceDirty = false;
        state.lastViewerRevision = viewer.revision();
        state.lastIndexRevision = indexRevision;
        state.lastOcclusionRevision = currentOcclusionRevision;
        state.chunkX = viewer.chunkX();
        state.chunkZ = viewer.chunkZ();
        state.lastFullScanTick = tickCounter;

        long hideStarted = System.nanoTime();
        hideOutOfRangeReveals(viewer, state, settings, budget);
        maxHideNanos = Math.max(maxHideNanos, System.nanoTime() - hideStarted);

        if (state.joinTick < 0) {
            state.joinTick = tickCounter;
        }
        boolean ramping = tickCounter - state.joinTick < JOIN_RAMP_TICKS;
        int maxChecks = ramping ? RAMP_CHECKS_PER_TICK : MAX_REVEAL_CHECKS_PER_TICK;
        if (state.candidates.length == 0 || state.candidateCursor >= state.candidates.length) {
            long rebuildStarted = System.nanoTime();
            rebuildCandidates(viewer, state, settings, budget);
            maxRebuildNanos = Math.max(maxRebuildNanos, System.nanoTime() - rebuildStarted);
        }
        long evalStarted = System.nanoTime();
        evaluateCandidates(viewer, state, settings, budget, maxChecks);
        maxEvalNanos = Math.max(maxEvalNanos, System.nanoTime() - evalStarted);
    }

    // ── Reveal bookkeeping ─────────────────────────────────────────────────

    private void hideOutOfRangeReveals(ViewerSession viewer, ViewerState state,
                                       WorldSettings settings, TimeBudget budget) {
        double keepDistance = settings.blockProtection().revealDistance()
                * settings.blockProtection().keepDistanceFactor();
        double keepSq = keepDistance * keepDistance;
        long[] revealed = blockVisibility.revealedSnapshot(viewer.playerId());
        if (revealed.length == 0) {
            return;
        }
        World world = viewer.player().getWorld();
        long worldId = viewer.worldId();
        Map<Position, BlockData> changes = new HashMap<>();
        List<Long> hidePositions = new ArrayList<>();
        for (long pos : revealed) {
            if (budget.expired()) {
                flushFakeBatch(viewer, changes, hidePositions);
                state.forceDirty = true;
                return;
            }
            if (!index.isHidden(worldId, pos)) {
                // The block is no longer protected: the server already sent the real
                // change; just drop the marker.
                blockVisibility.markHidden(viewer.playerId(), pos);
                continue;
            }
            int y = BlockPosUtil.decodeY(pos);
            boolean yMasked = settings.yShield().masksBlock(viewer.eyeY(), y);
            if (!yMasked) {
                double dx = BlockPosUtil.decodeX(pos) + 0.5 - viewer.eyeX();
                double dy = y + 0.5 - viewer.eyeY();
                double dz = BlockPosUtil.decodeZ(pos) + 0.5 - viewer.eyeZ();
                if (dx * dx + dy * dy + dz * dz <= keepSq) {
                    continue;
                }
            }
            Material material = yMasked ? settings.yShield().filler()
                    : plugin.hiddenBlockIndex().filler(worldId, pos,
                    settings.blockProtection().replaceWith());
            changes.put(Position.block(BlockPosUtil.decodeX(pos), y, BlockPosUtil.decodeZ(pos)),
                    fillerFor(material));
            hidePositions.add(pos);
            if (changes.size() >= 8) {
                flushFakeBatch(viewer, changes, hidePositions);
                if (budget.expired()) {
                    state.forceDirty = true;
                    return;
                }
            }
        }
        flushFakeBatch(viewer, changes, hidePositions);
    }

    /**
     * Sends one multi-block update for all re-hides instead of one packet per block.
     * A large base leaving the reveal radius used to cost tens of main-thread packet
     * calls; markers are only cleared after a successful send so a failed batch retries.
     */
    private void flushFakeBatch(ViewerSession viewer, Map<Position, BlockData> changes,
                                List<Long> positions) {
        if (changes.isEmpty()) {
            return;
        }
        try {
            viewer.player().sendMultiBlockChange(changes);
            for (long pos : positions) {
                blockVisibility.markHidden(viewer.playerId(), pos);
                metrics.recordBlockRehidden();
            }
        } catch (RuntimeException ex) {
            metrics.recordInternalError();
            if (plugin.config().debug().verboseErrors()) {
                plugin.getLogger().log(Level.WARNING, "Failed to batch re-hide protected blocks", ex);
            }
        } finally {
            changes.clear();
            positions.clear();
        }
    }

    private void hideAllRevealed(ViewerSession viewer, ViewerState state) {
        long[] revealed = blockVisibility.revealedSnapshot(viewer.playerId());
        for (long pos : revealed) {
            blockVisibility.markHidden(viewer.playerId(), pos);
        }
        state.reset();
    }

    private void rebuildCandidates(ViewerSession viewer, ViewerState state, WorldSettings settings,
                                   TimeBudget budget) {
        long worldId = viewer.worldId();
        int radius = Math.max(1, (int) Math.ceil(settings.blockProtection().revealDistance() / 16.0));
        int centerX = viewer.blockX() >> 4;
        int centerZ = viewer.blockZ() >> 4;
        List<CandidatePlan.Chunk> chunks = new ArrayList<>();
        outer:
        for (int dx = -radius; dx <= radius; dx++) {
            for (int dz = -radius; dz <= radius; dz++) {
                if (budget.expired()) {
                    state.forceDirty = true;
                    break outer;
                }
                HiddenBlockIndex.ChunkView view = index.chunkView(worldId, centerX + dx, centerZ + dz);
                if (view == null || view.size() == 0) {
                    continue;
                }
                chunks.add(new CandidatePlan.Chunk(centerX + dx, centerZ + dz, view.positions()));
            }
        }
        // Fair selection: every chunk gets a quota before any chunk can consume the
        // whole 2,048-position budget. Previously a dense base permanently starved the
        // chunks at the end of the scan order, so their containers stayed stone.
        long[] candidates = CandidatePlan.select(chunks, centerX, centerZ, MAX_CANDIDATES_PER_SCAN);
        state.candidates = candidates;
        state.candidateCursor = 0;
        state.hiddenCandidates = candidates.length;
    }

    private void evaluateCandidates(ViewerSession viewer, ViewerState state, WorldSettings settings,
                                    TimeBudget budget, int maxChecks) {
        long[] candidates = state.candidates;
        int cursor = state.candidateCursor;
        int checks = 0;
        World world = viewer.player().getWorld();
        long worldId = viewer.worldId();
        double maxDistance = settings.blockProtection().revealDistance();
        double maxDistanceSq = maxDistance * maxDistance;
        double fovCos = settings.blockProtection().fovCosHalf();
        // Reveal only blocks in chunks the client already has; otherwise the fake
        // information has not arrived yet and a block-change packet would be ignored.
        Player player = viewer.player();
        while (cursor < candidates.length && checks < maxChecks) {
            if (budget.expired()) {
                state.candidateCursor = cursor;
                return;
            }
            long pos = candidates[cursor++];
            checks++;
            metrics.recordBlockEvaluation();
            if (!index.isHidden(worldId, pos)) {
                continue;
            }
            if (blockVisibility.isRevealed(viewer.playerId(), pos)) {
                continue;
            }
            int x = BlockPosUtil.decodeX(pos);
            int y = BlockPosUtil.decodeY(pos);
            int z = BlockPosUtil.decodeZ(pos);
            if (settings.yShield().masksBlock(viewer.eyeY(), y)) {
                // Never reveal a protected block through the Y-shield filler, even when a
                // real cave line of sight happens to exist from the surface.
                continue;
            }
            double centerX = x + 0.5;
            double centerY = y + 0.5;
            double centerZ = z + 0.5;
            double dx = centerX - viewer.eyeX();
            double dy = centerY - viewer.eyeY();
            double dz = centerZ - viewer.eyeZ();
            double distanceSq = dx * dx + dy * dy + dz * dz;
            if (distanceSq > maxDistanceSq) {
                skipDistance++;
                continue;
            }
            if (!OcclusionEngine.insideFov(viewer, centerX, centerY, centerZ, fovCos)) {
                skipFov++;
                continue;
            }
            if (!plugin.raycastBudget().tryConsumeBlock()) {
                metrics.recordRaycastDeferred();
                state.forceDirty = true;
                state.candidateCursor = cursor;
                skipBudget++;
                return;
            }
            // Aim at the visible surface of the block (half a block toward the eye).
            double length = Math.sqrt(distanceSq);
            if (length < 1.0e-4) {
                continue;
            }
            // Aim at the block centre; the tracer treats reaching the target block itself as
            // visible (previously the ray hit the chest hitbox and the block stayed hidden).
            boolean visible = occlusion.hasLineOfSight(world,
                    viewer.eyeX(), viewer.eyeY(), viewer.eyeZ(), centerX, centerY, centerZ,
                    x, y, z);
            if (visible) {
                reveal(viewer, world, x, y, z, settings);
                revealCount++;
            }
            // A single raycast on real terrain can be expensive; stop as soon as the tick
            // budget is gone instead of checking only every 16 candidates.
            if (budget.expired()) {
                state.forceDirty = true;
                state.candidateCursor = cursor;
                return;
            }
        }
        state.candidateCursor = cursor;
    }

    private void reveal(ViewerSession viewer, World world, int x, int y, int z, WorldSettings settings) {
        long pos = BlockPosUtil.encode(x, y, z);
        blockVisibility.markRevealed(viewer.playerId(), pos);
        try {
            Block block = world.getBlockAt(x, y, z);
            viewer.player().sendBlockChange(block.getLocation(), block.getBlockData());
            metrics.recordBlockRevealed();
        } catch (RuntimeException ex) {
            blockVisibility.markHidden(viewer.playerId(), pos);
            metrics.recordInternalError();
            if (plugin.config().debug().verboseErrors()) {
                plugin.getLogger().log(Level.WARNING, "Failed to reveal protected block", ex);
            }
        }
    }



    public BlockData fillerFor(WorldSettings settings) {
        return fillerFor(settings.blockProtection().replaceWith());
    }

    public BlockData fillerFor(Material material) {
        BlockData cached = fillerData.get(material);
        if (cached == null) {
            cached = material.createBlockData();
            fillerData.put(material, cached);
        }
        return cached;
    }

    public AtomicLong occlusionRevision() {
        return occlusionRevision;
    }

    private boolean isBypassed(ViewerSession viewer) {
        return viewer.bypass();
    }

    public void clear() {
        states.clear();
        fillerData.clear();
    }

    public String diagnostics() {
        int candidates = 0;
        for (ViewerState state : states.values()) {
            candidates += state.candidates.length - state.candidateCursor;
        }
        return "viewers=" + states.size() + " revealedMarkers=" + blockVisibility.totalRevealedMarkers()
                + " pendingCandidates=" + Math.max(0, candidates)
                + " occlusionRevision=" + occlusionRevision.get()
                + " phaseMax(us) hide/rebuild/eval=" + (maxHideNanos / 1000)
                + "/" + (maxRebuildNanos / 1000) + "/" + (maxEvalNanos / 1000)
                + " revealed=" + revealCount + " skips(notSent/dist/fov/budget)="
                + skipNotSent + "/" + skipDistance + "/" + skipFov + "/" + skipBudget;
    }

    /** Runtime invariants for /aegishider verify. Main thread. */
    public List<String> verify() {
        List<String> problems = new ArrayList<>();
        for (Map.Entry<UUID, ViewerState> entry : states.entrySet()) {
            ViewerSession session = sessions.get(entry.getKey());
            if (session == null) {
                problems.add("block shield state without session: " + entry.getKey());
                continue;
            }
            long[] revealed = blockVisibility.revealedSnapshot(entry.getKey());
            for (long pos : revealed) {
                if (!index.isHidden(session.worldId(), pos)) {
                    problems.add("stale reveal marker for non-protected block: " + pos);
                    break;
                }
            }
        }
        return problems;
    }
}
