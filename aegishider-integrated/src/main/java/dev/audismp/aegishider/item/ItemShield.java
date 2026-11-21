package dev.audismp.aegishider.item;

import dev.audismp.aegishider.AegishiderPlugin;
import dev.audismp.aegishider.config.WorldSettings;
import dev.audismp.aegishider.core.SessionRegistry;
import dev.audismp.aegishider.core.TimeBudget;
import dev.audismp.aegishider.core.ViewerSession;
import dev.audismp.aegishider.core.WorldKeys;
import dev.audismp.aegishider.metrics.Metrics;
import dev.audismp.aegishider.occlusion.OcclusionEngine;
import dev.audismp.aegishider.util.BlockPosUtil;
import it.unimi.dsi.fastutil.ints.IntOpenHashSet;
import org.bukkit.Chunk;
import org.bukkit.World;
import org.bukkit.entity.ArmorStand;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Item;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Level;

/**
 * ItemShield - fail-closed per-viewer visibility for dropped items and other configured
 * entity types.
 *
 * <p>Security invariant: a protected entity is invisible to every player by default
 * (Paper {@code Entity#setVisibleByDefault(false)}); it is only shown when the visibility
 * policy positively proves it may be sent (distance + optional field of view + occlusion,
 * or explicit permission/owner grace). The client therefore never receives a spawn packet,
 * metadata, movement, velocity or item-stack data for an object it is not allowed to see.
 *
 * <p>Gameplay is untouched server-side: pickups, merging, physics, despawn timers and
 * inventory contents are never modified. Hidden items can still be picked up because
 * pickup is validated server-side.
 *
 * <p>Threading: all state transitions happen on the main thread. The packet thread reads
 * only the concurrent primitive data ({@link #byId}, {@link TrackedEntity#revealedViewers}).
 */
public final class ItemShield {

    /** Hard cap of entity/viewer policy evaluations per tick (prevents item-farm stalls). */
    private static final int MAX_EVALUATIONS_PER_TICK = 512;
    private static final boolean DEBUG_ENTITIES = Boolean.getBoolean("aegishider.debug.entities");
    /** How many tracked entities are polled for movement per tick. */
    private static final int MAX_POSITION_POLLS_PER_TICK = 1024;
    /** Entity packets may lag policy by this many ticks before being forced hidden. */
    private static final int MAX_STALE_TICKS = 12;
    /** Above this many pending dirty items a distance/owner-priority storm lane is used. */
    private static final int STORM_THRESHOLD = 64;
    /** Owner grace: own item is visible within this distance... */
    private static final double OWNER_GRACE_DISTANCE_SQ = 8.0 * 8.0;
    /** ...or for this many ticks after it spawned, whichever applies. */
    private static final int OWNER_GRACE_TICKS = 40;

    private final AegishiderPlugin plugin;
    private final Metrics metrics;
    private final SessionRegistry sessions;
    private final OcclusionEngine occlusion;

    /** Packet-thread visible: entity id -> tracked entity. Read from Netty. */
    private final ConcurrentHashMap<Integer, TrackedEntity> byId = new ConcurrentHashMap<>();
    /** Main-thread list for bounded round-robin polling of movement. */
    private final ArrayList<TrackedEntity> pollList = new ArrayList<>();
    /** Main-thread spatial index: chunk key -> tracked entity ids. */
    private final HashMap<Long, IntOpenHashSet> byChunk = new HashMap<>(256);
    /** Main-thread spatial index: chunk key -> viewers currently in that chunk. */
    private final HashMap<Long, ArrayList<ViewerSession>> viewersByChunk = new HashMap<>(256);
    private final Map<UUID, ViewerItemState> viewerStates = new HashMap<>(64);

    private final ArrayDeque<TrackedEntity> dirty = new ArrayDeque<>();
    private final ArrayDeque<TrackedEntity> retry = new ArrayDeque<>();
    private final IntOpenHashSet dirtyIds = new IntOpenHashSet();

    private int pollCursor;
    private int tickCounter;
    private long indexRevisionAtLastEval;
    private int revealedPairCount;

    public ItemShield(AegishiderPlugin plugin, Metrics metrics, SessionRegistry sessions,
                      OcclusionEngine occlusion) {
        this.plugin = plugin;
        this.metrics = metrics;
        this.sessions = sessions;
        this.occlusion = occlusion;
        if (DEBUG_ENTITIES) {
            plugin.getLogger().info("[debug] entity decision logging enabled");
        }
    }

    // ── Registration ───────────────────────────────────────────────────────

    /** Registers a newly spawned or newly loaded entity if its type is protected. */
    public void onEntityAvailable(Entity entity) {
        if (entity instanceof Player) {
            return;
        }
        // Note: EntitySpawnEvent/ItemSpawnEvent fire while the entity is being added, so
        // Entity#isValid() may still be false here. Registration must not depend on it -
        // that check dropped every item spawn and was the second half of the item ESP bug.
        World world = entity.getWorld();
        WorldSettings settings = plugin.config().world(world.getName());
        if (!settings.itemsEnabled()) {
            return;
        }
        EntityType type = entity.getType();
        if (DEBUG_ENTITIES) {
            plugin.getLogger().info("[debug] entity_available type=" + type + " hidden=" + settings.itemProtection().isHiddenType(type) + " valid=" + entity.isValid());
        }
        if (!settings.itemProtection().isHiddenType(type)) {
            return;
        }
        if (DEBUG_ENTITIES && type == EntityType.ZOMBIE) {
            plugin.getLogger().info("[debug] track zombie id=" + entity.getEntityId() + " valid=" + entity.isValid());
        }
        if (byId.containsKey(entity.getEntityId())) {
            TrackedEntity existing = byId.get(entity.getEntityId());
            if (existing != null && existing.entityUuid.equals(entity.getUniqueId())) {
                return; // already tracked
            }
            if (existing != null) {
                unregister(existing, "entity id reused");
            }
        }
        TrackedEntity tracked = new TrackedEntity(entity, WorldKeys.idOf(world), plugin.currentTick());
        byId.put(entity.getEntityId(), tracked);
        pollList.add(tracked);
        tracked.listIndex = pollList.size() - 1;
        long chunkKey = BlockPosUtil.chunkKey(tracked.worldId,
                tracked.blockX >> 4, tracked.blockZ >> 4);
        byChunk.computeIfAbsent(chunkKey, k -> new IntOpenHashSet(4)).add(entity.getEntityId());
        tracked.chunkKey = chunkKey;
        metrics.recordItemTracked();
        metrics.setTrackedItemCount(byId.size());

        // Fail-closed: hide from every player before any tracking packet can be sent.
        entity.setVisibleByDefault(false);
        // Entities registered *after* they were already tracked (chunk-loaded entities,
        // reload sweep, config change adding a new hidden type) are not affected by
        // setVisibleByDefault(false) for players that already track them. Explicitly send
        // a hide for every current viewer so a cheat client cannot keep them in its ESP.
        // Newly spawned entities are not yet tracked (isValid()==false inside the spawn
        // event), so this loop is skipped on the hot spawn path.
        if (entity.isValid()) {
            hideAlreadyTrackedFromViewers(tracked);
        }
        markDirty(tracked);
    }

    private void hideAlreadyTrackedFromViewers(TrackedEntity tracked) {
        Entity entity = tracked.entity;
        for (Player viewer : plugin.getServer().getOnlinePlayers()) {
            try {
                if (viewer.canSee(entity)) {
                    viewer.hideEntity(plugin, entity);
                    tracked.revealedViewers.remove(viewer.getUniqueId());
                }
            } catch (RuntimeException ex) {
                // Fail-closed: no marker is set, so the packet filter still suppresses
                // every subsequent packet for this entity even if the hide call failed.
                metrics.recordInternalError();
            }
        }
    }

    /** Removes an entity from protection tracking (despawn, pickup, chunk unload, death). */
    public void onEntityRemoved(Entity entity) {
        TrackedEntity tracked = byId.get(entity.getEntityId());
        if (tracked != null && tracked.entityUuid.equals(entity.getUniqueId())) {
            unregister(tracked, "removed");
        }
    }

    /** Re-evaluates an already tracked entity (item stack changed, merged, etc.). */
    public void onEntityChanged(Entity entity) {
        TrackedEntity tracked = byId.get(entity.getEntityId());
        if (tracked != null && !tracked.removed) {
            markDirty(tracked);
        }
    }

    /**
     * Registers every protected entity in a chunk. Used by the startup sweep and the
     * reconciliation sweep (entities in chunks that were already loaded before the plugin
     * was enabled). Must run on the main thread.
     */
    public void sweepChunk(Chunk chunk) {
        World world = chunk.getWorld();
        WorldSettings settings = plugin.config().world(world.getName());
        if (!settings.itemsEnabled()) {
            return;
        }
        Entity[] entities;
        try {
            entities = chunk.getEntities();
        } catch (RuntimeException ex) {
            metrics.recordInternalError();
            return;
        }
        for (Entity entity : entities) {
            onEntityAvailable(entity);
        }
    }

    /** Safety net for spawn paths that bypass the event APIs (commands, plugins). */
    public void sweepNearbyEntities(Player player, double radius) {
        if (!player.isOnline()) {
            return;
        }
        WorldSettings settings = plugin.config().world(player.getWorld().getName());
        if (!settings.itemProtection().enabled()) {
            return;
        }
        for (Entity entity : player.getWorld().getNearbyEntities(player.getLocation(), radius, radius, radius)) {
            if (entity instanceof Player) {
                continue;
            }
            if (settings.itemProtection().isHiddenType(entity.getType())) {
                onEntityAvailable(entity);
            }
        }
    }

    public void sweepChunkRadius(Player player, int radiusChunks) {
        World world = player.getWorld();
        int centerX = player.getLocation().getBlockX() >> 4;
        int centerZ = player.getLocation().getBlockZ() >> 4;
        int radius = Math.max(0, Math.min(8, radiusChunks));
        for (int dx = -radius; dx <= radius; dx++) {
            for (int dz = -radius; dz <= radius; dz++) {
                if (world.isChunkLoaded(centerX + dx, centerZ + dz)) {
                    sweepChunk(world.getChunkAt(centerX + dx, centerZ + dz));
                }
            }
        }
    }

    /**
     * Plugin disable/reload: restore vanilla visibility for every tracked entity and drop
     * all state. Never leaves entities permanently invisible.
     */
    public void shutdownRestoreVisibility() {
        for (TrackedEntity tracked : new ArrayList<>(byId.values())) {
            try {
                if (tracked.entity != null && tracked.entity.isValid()) {
                    tracked.revealedViewers.clear();
                    tracked.entity.setVisibleByDefault(true);
                }
            } catch (RuntimeException ex) {
                metrics.recordInternalError();
            }
        }
        byId.clear();
        pollList.clear();
        byChunk.clear();
        viewersByChunk.clear();
        viewerStates.clear();
        dirty.clear();
        retry.clear();
        dirtyIds.clear();
        revealedPairCount = 0;
        metrics.setTrackedItemCount(0);
        metrics.setRevealedItemViewerPairs(0);
    }

    /**
     * Applies a new configuration after /aegishider reload: entities whose type is no longer
     * protected are deregistered and made visible again; all others stay fail-closed.
     */
    public void reconfigure() {
        List<TrackedEntity> noLongerProtected = new ArrayList<>();
        for (TrackedEntity tracked : byId.values()) {
            if (tracked.removed) {
                continue;
            }
            World world = tracked.entity.getWorld();
            WorldSettings settings = plugin.config().world(world.getName());
            if (!settings.itemsEnabled()
                    || !settings.itemProtection().isHiddenType(tracked.entity.getType())) {
                noLongerProtected.add(tracked);
            } else {
                markDirty(tracked);
            }
        }
        for (TrackedEntity tracked : noLongerProtected) {
            try {
                // No longer protected: restore normal (visible by default) behaviour.
                tracked.entity.setVisibleByDefault(true);
            } catch (RuntimeException ex) {
                metrics.recordInternalError();
            }
            unregister(tracked, "configuration change");
        }
    }

    private void unregister(TrackedEntity tracked, String reason) {
        if (tracked.removed) {
            return;
        }
        tracked.removed = true;
        byId.remove(tracked.entityId, tracked);
        int last = pollList.size() - 1;
        if (tracked.listIndex >= 0 && tracked.listIndex <= last) {
            TrackedEntity moved = pollList.get(last);
            pollList.set(tracked.listIndex, moved);
            moved.listIndex = tracked.listIndex;
            pollList.remove(last);
        }
        tracked.listIndex = -1;
        IntOpenHashSet chunkSet = byChunk.get(tracked.chunkKey);
        if (chunkSet != null) {
            chunkSet.remove(tracked.entityId);
            if (chunkSet.isEmpty()) {
                byChunk.remove(tracked.chunkKey);
            }
        }
        // Clear reveal markers; native removal packets are unaffected by the packet filter.
        for (UUID viewer : tracked.revealedViewers.keySet()) {
            ViewerItemState state = viewerStates.get(viewer);
            if (state != null) {
                state.revealedItems.remove(tracked.entityId);
            }
            revealedPairCount--;
        }
        tracked.revealedViewers.clear();
        if (revealedPairCount < 0) {
            revealedPairCount = 0;
        }
        metrics.setRevealedItemViewerPairs(revealedPairCount);
        metrics.recordItemUntracked();
        metrics.setTrackedItemCount(byId.size());
    }

    // ── Viewer lifecycle (main thread, called by listeners) ────────────────

    public void onViewerJoin(ViewerSession session) {
        viewerStates.put(session.playerId(), new ViewerItemState());
        addViewerToChunkIndex(session);
        markItemsNearViewerDirty(session);
    }

    public void onViewerQuit(UUID viewerId) {
        ViewerItemState state = viewerStates.remove(viewerId);
        if (state != null) {
            for (int entityId : state.revealedItems) {
                TrackedEntity tracked = byId.get(entityId);
                if (tracked != null) {
                    tracked.revealedViewers.remove(viewerId);
                    revealedPairCount--;
                }
            }
            state.revealedItems.clear();
        }
        if (revealedPairCount < 0) {
            revealedPairCount = 0;
        }
        metrics.setRevealedItemViewerPairs(revealedPairCount);
        removeViewerFromChunkIndex(viewerId);
    }

    /** Viewer moved to another chunk / world or significant look change. */
    public void onViewerMoved(ViewerSession session, boolean chunkChanged, boolean significant) {
        if (chunkChanged) {
            removeViewerFromChunkIndex(session.playerId());
            addViewerToChunkIndex(session);
        }
        if (significant) {
            markItemsNearViewerDirty(session);
        }
    }

    /** World change / respawn: client entity list is reset; re-evaluate from scratch. */
    public void onViewerWorldChanged(ViewerSession session) {
        ViewerItemState state = viewerStates.get(session.playerId());
        if (state != null) {
            // Do not just drop the bookkeeping: a same-world teleport does not clear
            // the client's entity list, so a mob revealed on the previous floor would
            // stay visible after the viewer moved. Send an explicit hide for every
            // revealed entity before clearing the markers.
            int[] revealed = state.revealedItems.toIntArray();
            for (int entityId : revealed) {
                TrackedEntity tracked = byId.get(entityId);
                if (tracked != null) {
                    hide(tracked, session);
                }
            }
            state.revealedItems.clear();
        }
        if (revealedPairCount < 0) {
            revealedPairCount = 0;
        }
        metrics.setRevealedItemViewerPairs(revealedPairCount);
        removeViewerFromChunkIndex(session.playerId());
        addViewerToChunkIndex(session);
        // A teleport/respawn invalidates the client's entity state. Force re-evaluation:
        // the normal same-tick dedupe in markDirty would otherwise drop the whole
        // sweep if the entity was already evaluated earlier in this tick, leaving a
        // previously revealed mob visible after the viewer changed floor.
        markItemsNearViewerDirty(session, true);
    }

    private static final class ViewerItemState {
        final IntOpenHashSet revealedItems = new IntOpenHashSet(16);
    }

    private void addViewerToChunkIndex(ViewerSession session) {
        long chunkKey = BlockPosUtil.chunkKey(session.worldId(),
                session.blockX() >> 4, session.blockZ() >> 4);
        viewersByChunk.computeIfAbsent(chunkKey, k -> new ArrayList<>(4)).add(session);
    }

    private void removeViewerFromChunkIndex(UUID viewerId) {
        for (var iterator = viewersByChunk.entrySet().iterator(); iterator.hasNext(); ) {
            var entry = iterator.next();
            ArrayList<ViewerSession> list = entry.getValue();
            for (int i = list.size() - 1; i >= 0; i--) {
                if (list.get(i).playerId().equals(viewerId)) {
                    list.remove(i);
                }
            }
            if (list.isEmpty()) {
                iterator.remove();
            }
        }
    }

    // ── Block change invalidation ──────────────────────────────────────────

    /** A block around a tracked entity changed: line of sight may have changed. */
    public void onBlockChanged(World world, int x, int y, int z) {
        long worldId = WorldKeys.idOf(world);
        int cx = x >> 4;
        int cz = z >> 4;
        for (int dx = -1; dx <= 1; dx++) {
            for (int dz = -1; dz <= 1; dz++) {
                IntOpenHashSet ids = byChunk.get(BlockPosUtil.chunkKey(worldId, cx + dx, cz + dz));
                if (ids == null) {
                    continue;
                }
                for (int entityId : ids) {
                    TrackedEntity tracked = byId.get(entityId);
                    if (tracked != null && !tracked.removed) {
                        markDirty(tracked);
                    }
                }
            }
        }
    }

    // ── Tick ───────────────────────────────────────────────────────────────

    public void tick(TimeBudget budget, int tick) {
        long startNanos = System.nanoTime();
        tickCounter = tick;
        try {
            pollPositions(budget);
            evaluateDirty(budget);
        } catch (RuntimeException ex) {
            metrics.recordInternalError();
            plugin.getLogger().log(Level.SEVERE, "ItemShield tick error (fail-closed: items remain hidden)", ex);
            // Fail closed: any entity whose state could not be evaluated stays hidden.
        } finally {
            metrics.recordItemDecision(System.nanoTime() - startNanos);
        }
    }

    private void pollPositions(TimeBudget budget) {
        int size = pollList.size();
        if (size == 0) {
            return;
        }
        int limit = Math.min(size, MAX_POSITION_POLLS_PER_TICK);
        for (int i = 0; i < limit; i++) {
            if ((i & 63) == 0 && budget.expired()) {
                return;
            }
            int index = (pollCursor + i) % size;
            TrackedEntity tracked = pollList.get(index);
            int before = tracked.positionRevision;
            tracked.refreshPositionFromEntity();
            if (tracked.positionRevision != before) {
                markDirty(tracked);
            }
        }
        pollCursor = (pollCursor + limit) % Math.max(1, size);
    }

    private void evaluateDirty(TimeBudget budget) {
        if (dirty.isEmpty()) {
            return;
        }
        long indexRevision = plugin.hiddenBlockIndex().revision();
        if (dirtyIds.size() > STORM_THRESHOLD) {
            evaluateStorm(budget, indexRevision);
        } else {
            evaluateFifo(budget, indexRevision);
        }
        // Items deferred by the raycast budget are retried on the following tick only.
        while (!retry.isEmpty() && dirtyIds.size() < MAX_EVALUATIONS_PER_TICK) {
            TrackedEntity tracked = retry.pollFirst();
            if (tracked != null && !tracked.removed) {
                markDirty(tracked);
            }
        }
        // Keep the per-tick queue bounded: anything left is picked up by the next poll cycle.
        if (dirty.size() > MAX_EVALUATIONS_PER_TICK * 4) {
            int drop = dirty.size() - MAX_EVALUATIONS_PER_TICK * 2;
            for (int i = 0; i < drop; i++) {
                TrackedEntity tracked = dirty.pollFirst();
                if (tracked == null) {
                    break;
                }
                dirtyIds.remove(tracked.entityId);
                if (!tracked.removed) {
                    retry.addLast(tracked);
                }
            }
        }
    }

    private void evaluateFifo(TimeBudget budget, long indexRevision) {
        int evaluated = 0;
        while (!dirty.isEmpty() && evaluated < MAX_EVALUATIONS_PER_TICK) {
            if ((evaluated & 31) == 0 && budget.expired()) {
                break;
            }
            TrackedEntity tracked = dirty.pollFirst();
            dirtyIds.remove(tracked.entityId);
            if (tracked == null || tracked.removed) {
                continue;
            }
            evaluated++;
            metrics.recordItemEvaluation();
            try {
                evaluate(tracked, indexRevision);
            } catch (RuntimeException ex) {
                metrics.recordInternalError();
                if (plugin.config().debug().verboseErrors()) {
                    plugin.getLogger().log(Level.WARNING, "ItemShield evaluation error", ex);
                }
                requeue(tracked);
            }
        }
    }

    /**
     * Spawn-storm lane: a burst of new items (farms, explosions, shops) is evaluated nearest
     * first and owner-grace first, so the player-visible items appear immediately while far
     * items are spread over the next ticks instead of monopolising one tick.
     */
    private void evaluateStorm(TimeBudget budget, long indexRevision) {
        int take = Math.min(MAX_EVALUATIONS_PER_TICK, dirty.size());
        TrackedEntity[] batch = new TrackedEntity[take];
        int count = 0;
        while (count < take) {
            TrackedEntity tracked = dirty.pollFirst();
            if (tracked == null) {
                break;
            }
            dirtyIds.remove(tracked.entityId);
            if (!tracked.removed) {
                batch[count++] = tracked;
            }
        }
        if (count == 0) {
            return;
        }
        List<ViewerSession> viewers = new ArrayList<>(sessions.all());
        boolean[] ownerVisible = new boolean[count];
        double[] minDistanceSq = new double[count];
        for (int i = 0; i < count; i++) {
            TrackedEntity tracked = batch[i];
            tracked.refreshPositionFromEntity();
            minDistanceSq[i] = Double.MAX_VALUE;
            for (int v = 0; v < viewers.size(); v++) {
                ViewerSession viewer = viewers.get(v);
                if (!viewer.isWorldKnown() || viewer.worldId() != tracked.worldId) {
                    continue;
                }
                double distanceSq = OcclusionEngine.distanceSq(viewer, tracked.centerX,
                        tracked.centerY, tracked.centerZ);
                if (distanceSq < minDistanceSq[i]) {
                    minDistanceSq[i] = distanceSq;
                }
                if (tracked.thrower != null && tracked.thrower.equals(viewer.playerId())) {
                    ownerVisible[i] = true;
                }
            }
        }
        int[] order = ItemStormOrder.order(ownerVisible, minDistanceSq);
        metrics.recordItemStorm(count);
        int evaluated = 0;
        int remainingStart = 0;
        for (int i = 0; i < order.length; i++) {
            if ((evaluated & 15) == 0 && budget.expired()) {
                remainingStart = i;
                break;
            }
            TrackedEntity tracked = batch[order[i]];
            evaluated++;
            metrics.recordItemEvaluation();
            try {
                evaluate(tracked, indexRevision);
            } catch (RuntimeException ex) {
                metrics.recordInternalError();
                if (plugin.config().debug().verboseErrors()) {
                    plugin.getLogger().log(Level.WARNING, "ItemShield storm evaluation error", ex);
                }
                requeue(tracked);
            }
            remainingStart = i + 1;
        }
        for (int i = remainingStart; i < order.length; i++) {
            requeue(batch[order[i]]);
        }
    }

    private void evaluate(TrackedEntity tracked, long indexRevision) {
        if (!tracked.entity.isValid()) {
            unregister(tracked, "invalid");
            return;
        }
        Entity entity = tracked.entity;
        World world = entity.getWorld();
        WorldSettings settings = plugin.config().world(world.getName());
        if (!settings.itemsEnabled() || !settings.itemProtection().isHiddenType(entity.getType())) {
            restoreAndUntrack(tracked);
            return;
        }
        tracked.refreshPositionFromEntity();
        List<ViewerSession> viewers = nearbyViewers(tracked);
        long viewerRevisionHash = 0L;
        for (int i = 0; i < viewers.size(); i++) {
            viewerRevisionHash += viewers.get(i).revision();
        }
        if (tracked.positionRevision == tracked.evaluatedPositionRevision
                && tracked.lastEvalTick == tickCounter
                && tracked.lastEvaluatedIndexRevision == indexRevision
                && tracked.lastViewerRevisionHash == viewerRevisionHash) {
            return;
        }

        boolean budgetExhausted = false;
        for (ViewerSession viewer : viewers) {
            boolean currentlyRevealed = tracked.revealedViewers.containsKey(viewer.playerId());
            EvalOutcome outcome = evaluateViewer(tracked, viewer, settings);
            switch (outcome) {
                case VISIBLE -> {
                    if (!currentlyRevealed) {
                        show(tracked, viewer);
                    }
                }
                case HIDDEN -> {
                    if (currentlyRevealed) {
                        hide(tracked, viewer);
                    }
                }
                case DEFERRED -> {
                    budgetExhausted = true;
                    // Keep current state, but bound staleness: after MAX_STALE_TICKS force hide.
                    if (currentlyRevealed
                            && tickCounter - tracked.lastSuccessfulEvalTick > MAX_STALE_TICKS) {
                        hide(tracked, viewer);
                    }
                }
            }
        }
        tracked.evaluatedPositionRevision = tracked.positionRevision;
        tracked.lastEvaluatedIndexRevision = indexRevision;
        tracked.lastViewerRevisionHash = viewerRevisionHash;
        tracked.lastEvalTick = tickCounter;
        if (!budgetExhausted) {
            tracked.lastSuccessfulEvalTick = tickCounter;
        } else {
            requeue(tracked);
        }
    }

    private enum EvalOutcome {
        VISIBLE, HIDDEN, DEFERRED
    }

    private EvalOutcome evaluateViewer(TrackedEntity tracked, ViewerSession viewer,
                                                     WorldSettings settings) {
        if (!viewer.player().isOnline() || !viewer.isWorldKnown()
                || viewer.worldId() != tracked.worldId) {
            return EvalOutcome.HIDDEN;
        }
        WorldSettings.ItemProtection policy = settings.itemProtection();
        if (viewer.bypass()) {
            return EvalOutcome.VISIBLE;
        }
        double distSq = OcclusionEngine.distanceSq(viewer, tracked.centerX, tracked.centerY, tracked.centerZ);
        double maxDist = policy.revealDistance();
        // Owner grace is deliberately bounded: the thrower only sees their own item while
        // it is still close or for a short time after it was dropped. An unbounded owner
        // exemption would let a cheat client keep tracking the player's own items forever.
        if (policy.ownerGrace() && tracked.thrower != null
                && tracked.thrower.equals(viewer.playerId())) {
            if (distSq <= OWNER_GRACE_DISTANCE_SQ
                    || tickCounter - tracked.spawnTick <= OWNER_GRACE_TICKS) {
                return EvalOutcome.VISIBLE;
            }
        }
        // Hostile mobs are only hidden by real occlusion (walls, terrain, underground).
        // Turning away or standing farther away must not make them pop out: mob ESP is
        // less valuable to cheats than breaking normal fights.
        // Every living mob counts, not just Monster/Enemy: slimes, ghasts, golems and the
        // dragon all pop otherwise. Armor stands and players keep the strict policy because
        // they leak storage/player positions; items and minecarts do too (loot ESP).
        boolean livingMob = isLivingMob(tracked.entity);
        // Hard vertical band (anti-base-ESP) for living entities only: a player, mob or
        // animal on another floor is never sent, even with a clear line of sight. It only
        // applies when at least one side is below the configured underground Y, so cows on
        // a mountain, a tall tower or an elytra flight do not disappear. It is deliberately
        // NOT applied to dropped items, item frames, armor stands or minecarts, which keep
        // the existing distance/line-of-sight policy.
        if (livingMob && settings.entityHeightShield().separates(viewer.eyeY(), tracked.centerY)) {
            return EvalOutcome.HIDDEN;
        }
        boolean occlusionOnly = policy.occlusionOnlyMonsters() && livingMob;
        double allowedDistance = occlusionOnly ? policy.monsterMaxDistance() : maxDist;
        if (DEBUG_ENTITIES && livingMob) {
            plugin.getLogger().info("[debug] zombie eval viewer=" + viewer.player().getName() + " dist=" + Math.sqrt(distSq) + " occlusionOnly=" + occlusionOnly + " fov=" + OcclusionEngine.insideFov(viewer, tracked.centerX, tracked.centerY, tracked.centerZ, policy.fovCosHalf()));
        }
        if (distSq > allowedDistance * allowedDistance) {
            return EvalOutcome.HIDDEN;
        }
        if (!occlusionOnly) {
            // Very close objects are always visible to avoid frustrating near-camera pop-out.
            if (distSq <= 4.0) {
                return EvalOutcome.VISIBLE;
            }
            if (!OcclusionEngine.insideFov(viewer, tracked.centerX, tracked.centerY, tracked.centerZ,
                    policy.fovCosHalf())) {
                return EvalOutcome.HIDDEN;
            }
        } else if (distSq <= 16.0) {
            // Monsters in melee range are never hidden: a fence, stair or half slab under
            // the centre ray must not make a mob blink out during a fight.
            return EvalOutcome.VISIBLE;
        }
        if (!plugin.raycastBudget().tryConsume()) {
            metrics.recordRaycastDeferred();
            return EvalOutcome.DEFERRED;
        }
        boolean visible;
        if (livingMob) {
            // Sample the head as well as the centre: mobs behind low cover (fence, stair,
            // one-block ledge) are still partly visible and must not blink out.
            double headY = tracked.entity.getY() + tracked.entity.getHeight() * 0.85;
            boolean secondSample = plugin.raycastBudget().tryConsume();
            visible = secondSample
                    ? occlusion.anyLineOfSight(tracked.entity.getWorld(),
                    viewer.eyeX(), viewer.eyeY(), viewer.eyeZ(),
                    tracked.centerX, tracked.centerZ, tracked.centerY, headY)
                    : occlusion.hasLineOfSight(tracked.entity.getWorld(),
                    viewer.eyeX(), viewer.eyeY(), viewer.eyeZ(),
                    tracked.centerX, tracked.centerY, tracked.centerZ);
        } else {
            visible = occlusion.hasLineOfSight(tracked.entity.getWorld(),
                    viewer.eyeX(), viewer.eyeY(), viewer.eyeZ(),
                    tracked.centerX, tracked.centerY, tracked.centerZ);
        }
        if (DEBUG_ENTITIES && livingMob) {
            plugin.getLogger().info("[debug] zombie los=" + visible);
        }
        return visible ? EvalOutcome.VISIBLE : EvalOutcome.HIDDEN;
    }

    private void show(TrackedEntity tracked, ViewerSession viewer) {
        if (tracked.revealedViewers.putIfAbsent(viewer.playerId(), Boolean.TRUE) != null) {
            return;
        }
        ViewerItemState state = viewerStates.computeIfAbsent(viewer.playerId(), k -> new ViewerItemState());
        state.revealedItems.add(tracked.entityId);
        revealedPairCount++;
        metrics.setRevealedItemViewerPairs(revealedPairCount);
        metrics.recordItemReveal();
        if (DEBUG_ENTITIES && tracked.entity instanceof org.bukkit.entity.Monster) {
            plugin.getLogger().info("[debug] show zombie viewer=" + viewer.player().getName());
        }
        try {
            viewer.player().showEntity(plugin, tracked.entity);
        } catch (RuntimeException ex) {
            // Roll back the marker so the packet/entity policy filter keeps it hidden.
            tracked.revealedViewers.remove(viewer.playerId());
            state.revealedItems.remove(tracked.entityId);
            revealedPairCount--;
            metrics.setRevealedItemViewerPairs(Math.max(0, revealedPairCount));
            metrics.recordInternalError();
            plugin.getLogger().log(Level.WARNING, "Failed to show tracked entity; keeping it hidden", ex);
        }
    }

    private void hide(TrackedEntity tracked, ViewerSession viewer) {
        if (tracked.revealedViewers.remove(viewer.playerId()) == null) {
            return;
        }
        ViewerItemState state = viewerStates.get(viewer.playerId());
        if (state != null) {
            state.revealedItems.remove(tracked.entityId);
        }
        revealedPairCount--;
        metrics.setRevealedItemViewerPairs(Math.max(0, revealedPairCount));
        metrics.recordItemHide();
        try {
            viewer.player().hideEntity(plugin, tracked.entity);
        } catch (RuntimeException ex) {
            // The marker is already gone (fail-closed): even if the remove packet failed,
            // the packet filter will suppress every further packet for this entity.
            metrics.recordInternalError();
            if (plugin.config().debug().verboseErrors()) {
                plugin.getLogger().log(Level.WARNING, "Failed to hide tracked entity", ex);
            }
        }
    }

    /**
     * The entity or its world is no longer protected (config change, world change).
     * Restore vanilla visibility instead of leaving it hidden by default forever:
     * send a spawn to viewers that never passed the reveal policy, then untrack it.
     */
    private void restoreAndUntrack(TrackedEntity tracked) {
        try {
            tracked.entity.setVisibleByDefault(true);
        } catch (RuntimeException ex) {
            metrics.recordInternalError();
        }
        for (ViewerSession viewer : nearbyViewers(tracked)) {
            try {
                viewer.player().showEntity(plugin, tracked.entity);
            } catch (RuntimeException ex) {
                metrics.recordInternalError();
            }
        }
        unregister(tracked, "no longer protected");
    }

    // ── Nearby viewer/item lookup ──────────────────────────────────────────

    private List<ViewerSession> nearbyViewers(TrackedEntity tracked) {
        if (viewersByChunk.isEmpty()) {
            return List.of();
        }
        WorldSettings settings = plugin.config().world(tracked.entity.getWorld().getName());
        // Living mobs may be evaluated up to monster-max-distance, so the viewer index
        // must cover that radius too. Using the item distance (24) here silently capped
        // the configured 96-block monster range at roughly 48 blocks. Items, minecarts
        // and armor stands keep the much smaller item radius so dropped-item evaluation
        // does not scan a 96-block area for every entity.
        boolean livingMob = isLivingMob(tracked.entity);
        double searchDistance = livingMob && settings.itemProtection().occlusionOnlyMonsters()
                ? Math.max(settings.itemProtection().revealDistance(),
                settings.itemProtection().monsterMaxDistance())
                : settings.itemProtection().revealDistance();
        int radius = Math.max(1, (int) Math.ceil(searchDistance / 16.0) + 1);
        int centerX = tracked.blockX >> 4;
        int centerZ = tracked.blockZ >> 4;
        ArrayList<ViewerSession> result = new ArrayList<>(4);
        for (int dx = -radius; dx <= radius; dx++) {
            for (int dz = -radius; dz <= radius; dz++) {
                ArrayList<ViewerSession> list = viewersByChunk.get(
                        BlockPosUtil.chunkKey(tracked.worldId, centerX + dx, centerZ + dz));
                if (list == null || list.isEmpty()) {
                    continue;
                }
                for (int i = 0; i < list.size(); i++) {
                    ViewerSession viewer = list.get(i);
                    if (viewer.worldId() == tracked.worldId) {
                        result.add(viewer);
                    }
                }
            }
        }
        return result;
    }


    private void markItemsNearViewerDirty(ViewerSession viewer) {
        markItemsNearViewerDirty(viewer, false);
    }

    private void markItemsNearViewerDirty(ViewerSession viewer, boolean force) {
        if (byChunk.isEmpty() || !viewer.isWorldKnown()) {
            return;
        }
        WorldSettings.ItemProtection policy = plugin.config()
                .world(viewer.player().getWorld().getName()).itemProtection();
        double itemDistance = policy.revealDistance();
        // Living mobs can be revealed at monster-max-distance even when the item
        // distance is much smaller. A newly joined viewer must mark those mobs dirty
        // immediately; otherwise a stationary mob in the 24..96 block band stays
        // invisible until it happens to move. Items, item frames, armor stands and
        // minecarts keep the smaller item radius so this sweep does not grow to 96
        // blocks for every dropped item.
        double livingDistance = policy.occlusionOnlyMonsters()
                ? Math.max(itemDistance, policy.monsterMaxDistance())
                : itemDistance;
        double searchDistance = Math.max(itemDistance, livingDistance);
        int radius = Math.max(1, (int) Math.ceil(searchDistance / 16.0) + 1);
        int centerX = viewer.blockX() >> 4;
        int centerZ = viewer.blockZ() >> 4;
        for (int dx = -radius; dx <= radius; dx++) {
            for (int dz = -radius; dz <= radius; dz++) {
                IntOpenHashSet ids = byChunk.get(
                        BlockPosUtil.chunkKey(viewer.worldId(), centerX + dx, centerZ + dz));
                if (ids == null) {
                    continue;
                }
                for (int entityId : ids) {
                    TrackedEntity tracked = byId.get(entityId);
                    if (tracked == null || tracked.removed) {
                        continue;
                    }
                    double allowedDistance = isLivingMob(tracked.entity) ? livingDistance : itemDistance;
                    if (OcclusionEngine.distanceSq(viewer, tracked.centerX, tracked.centerY, tracked.centerZ)
                            > allowedDistance * allowedDistance) {
                        continue;
                    }
                    markDirty(tracked, force);
                }
            }
        }
    }

    private static boolean isLivingMob(Entity entity) {
        return entity instanceof LivingEntity
                && !(entity instanceof ArmorStand)
                && !(entity instanceof Player);
    }

    private void markDirty(TrackedEntity tracked) {
        markDirty(tracked, false);
    }

    private void markDirty(TrackedEntity tracked, boolean force) {
        if (tracked.removed) {
            return;
        }
        if (!force && tracked.lastEvalTick == tickCounter) {
            return; // already evaluated this tick
        }
        if (!dirtyIds.add(tracked.entityId)) {
            return;
        }
        dirty.addLast(tracked);
    }

    private void requeue(TrackedEntity tracked) {
        if (!tracked.removed && dirtyIds.add(tracked.entityId)) {
            retry.addLast(tracked);
        }
    }

    // ── Query API used by the packet gateway ───────────────────────────────

    /** Returns the tracked entity for a wire entity id, or null. Safe from Netty. */
    public TrackedEntity trackedByEntityId(int entityId) {
        return byId.get(entityId);
    }

    public boolean isProtectedType(EntityType type, World world) {
        WorldSettings settings = plugin.config().world(world.getName());
        return settings.itemProtection().isHiddenType(type);
    }

    public int trackedCount() {
        return byId.size();
    }

    public int revealedPairCount() {
        return revealedPairCount;
    }

    /** Number of entities currently revealed to one specific viewer (diagnostics). */
    public int revealedCountFor(UUID viewerId) {
        ViewerItemState state = viewerStates.get(viewerId);
        return state == null ? 0 : state.revealedItems.size();
    }

    /** Short per-type breakdown of tracked entities, e.g. {@code ZOMBIE=2, ITEM=1}. */
    public String trackedTypeSummary() {
        Map<EntityType, Integer> counts = new java.util.EnumMap<>(EntityType.class);
        for (TrackedEntity tracked : byId.values()) {
            if (tracked.removed) {
                continue;
            }
            counts.merge(tracked.entity.getType(), 1, Integer::sum);
        }
        if (counts.isEmpty()) {
            return "none";
        }
        StringBuilder summary = new StringBuilder();
        counts.entrySet().stream()
                .sorted((a, b) -> Integer.compare(b.getValue(), a.getValue()))
                .limit(8)
                .forEach(entry -> {
                    if (summary.length() > 0) {
                        summary.append(", ");
                    }
                    summary.append(entry.getKey()).append('=').append(entry.getValue());
                });
        return summary.toString();
    }

    /** Diagnostics for /aegishider diag. */
    public String summary() {
        return diagnostics();
    }

    // ── Diagnostics ────────────────────────────────────────────────────────

    public String diagnostics() {
        StringBuilder builder = new StringBuilder();
        builder.append("tracked=").append(byId.size())
                .append(" revealedPairs=").append(revealedPairCount)
                .append(" dirtyQueue=").append(dirty.size())
                .append(" viewerIndexChunks=").append(viewersByChunk.size())
                .append(" itemChunks=").append(byChunk.size());
        return builder.toString();
    }

    /**
     * Runtime invariant check for {@code /aegishider verify}. Returns a list of problems
     * (empty = healthy). Main thread only.
     */
    public List<String> verify() {
        List<String> problems = new ArrayList<>();
        for (TrackedEntity tracked : byId.values()) {
            if (tracked.entity == null || !tracked.entity.isValid()) {
                problems.add("tracked entity id " + tracked.entityId + " is no longer valid");
                continue;
            }
            if (tracked.entity.isVisibleByDefault()) {
                problems.add("tracked entity id " + tracked.entityId
                        + " is still visible-by-default (security invariant broken)");
            }
            if (tracked.removed) {
                problems.add("removed entity id " + tracked.entityId + " still in registry");
            }
            if (!tracked.revealedViewers.isEmpty() && tracked.entity.getTrackedBy().isEmpty()) {
                // Not necessarily a problem; kept for observability only.
            }
        }
        return problems;
    }

    // ── Tracked entity ─────────────────────────────────────────────────────

    /**
     * One protected entity. Netty reads {@link #revealedViewers} and identity fields only;
     * everything else is main-thread state.
     */
    public static final class TrackedEntity {
        final Entity entity;
        final int entityId;
        final UUID entityUuid;
        final long worldId;
        final ConcurrentHashMap<UUID, Boolean> revealedViewers = new ConcurrentHashMap<>(4);

        int blockX;
        int blockY;
        int blockZ;
        double centerX;
        double centerY;
        double centerZ;
        long chunkKey;
        int listIndex = -1;
        int positionRevision;
        int evaluatedPositionRevision = -1;
        int spawnTick;
        int lastEvalTick = -1;
        int lastSuccessfulEvalTick = -1;
        long lastEvaluatedIndexRevision = -1L;
        long lastViewerRevisionHash = Long.MIN_VALUE;
        UUID thrower;
        boolean removed;

        TrackedEntity(Entity entity, long worldId, int spawnTick) {
            this.entity = entity;
            this.entityId = entity.getEntityId();
            this.entityUuid = entity.getUniqueId();
            this.worldId = worldId;
            this.spawnTick = spawnTick;
            if (entity instanceof Item item) {
                this.thrower = item.getThrower();
            }
            refreshPositionFromEntity();
        }

        void refreshPositionFromEntity() {
            Entity current = entity;
            double x = current.getX();
            double y = current.getY();
            double z = current.getZ();
            int bx = (int) Math.floor(x);
            int by = (int) Math.floor(y);
            int bz = (int) Math.floor(z);
            centerX = x;
            centerY = y + 0.125;
            centerZ = z;
            if (bx != blockX || by != blockY || bz != blockZ) {
                blockX = bx;
                blockY = by;
                blockZ = bz;
                positionRevision++;
            }
        }

        public int entityId() {
            return entityId;
        }

        public UUID entityUuid() {
            return entityUuid;
        }

        public long worldId() {
            return worldId;
        }

        public Entity entity() {
            return entity;
        }

        /** Netty-thread safe: true when the viewer is currently allowed to see this entity. */
        public boolean isRevealedTo(UUID viewer) {
            return revealedViewers.containsKey(viewer);
        }
    }
}
