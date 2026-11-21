package dev.audismp.aegishider.listener;

import dev.audismp.aegishider.AegishiderPlugin;
import dev.audismp.aegishider.core.ViewerSession;
import dev.audismp.aegishider.core.WorldKeys;
import dev.audismp.aegishider.detection.RaidAnalytics;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;

/**
 * Viewer lifecycle + movement. All handlers are event-driven and do O(1) work on the
 * event thread; the actual visibility evaluation happens in the budgeted per-tick tasks.
 */
public final class PlayerListener implements Listener {

    private final AegishiderPlugin plugin;

    public PlayerListener(AegishiderPlugin plugin) {
        this.plugin = plugin;
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        ViewerSession session = plugin.sessions().create(player, plugin.currentTick());
        session.updateEye(player.getEyeLocation());
        session.setBypass(player.hasPermission(plugin.config()
                .world(player.getWorld().getName()).bypassPermission()));
        plugin.itemShield().onViewerJoin(session);
        plugin.blockShield().onViewerJoin(session);
        plugin.metrics().setOnlineSessions(plugin.sessions().size());
        plugin.getLogger().info("Viewer " + player.getName() + " joined: client="
                + (plugin.packetGateway() == null ? "unknown" : plugin.packetGateway().clientVersion(player))
                + ", world=" + player.getWorld().getName() + ", bypass=" + session.bypass()
                + ", gateway=" + (plugin.packetGateway() == null ? "missing"
                : plugin.packetGateway().statusLine()));
        // Loaded chunks around the player were loaded before the plugin could see them
        // (reload case): discover blocks and entities inside them.
        plugin.blockDiscovery().enqueueAround(player.getWorld(),
                player.getLocation().getBlockX() >> 4, player.getLocation().getBlockZ() >> 4, 3);
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onQuit(PlayerQuitEvent event) {
        Player player = event.getPlayer();
        plugin.itemShield().onViewerQuit(player.getUniqueId());
        plugin.blockShield().onViewerQuit(player.getUniqueId());
        plugin.playerShield().onViewerQuit(player.getUniqueId());
        plugin.sessions().remove(player.getUniqueId());
        plugin.miningAnalytics().cleanup(player.getUniqueId());
        plugin.metrics().setOnlineSessions(plugin.sessions().size());
    }

    /** Player-vs-player combat keeps both parties visible for the configured grace period. */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPlayerDamage(EntityDamageByEntityEvent event) {
        if (event.getEntity() instanceof Player victim && event.getDamager() instanceof Player attacker) {
            plugin.playerShield().markCombat(attacker, victim);
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onMove(PlayerMoveEvent event) {
        Player player = event.getPlayer();
        ViewerSession session = plugin.sessions().get(player.getUniqueId());
        if (session == null) {
            return;
        }
        Location to = event.getTo();
        if (to == null) {
            return;
        }
        int newChunkX = to.getBlockX() >> 4;
        int newChunkZ = to.getBlockZ() >> 4;
        boolean chunkChanged = newChunkX != session.chunkX() || newChunkZ != session.chunkZ();
        boolean significant = session.updateTransform(to, plugin.currentTick());
        if (!significant) {
            return;
        }
        session.updateEye(player.getEyeLocation());
        plugin.itemShield().onViewerMoved(session, chunkChanged, true);
        if (chunkChanged) {
            recordRaidVisit(player, session);
        }
    }

    private void recordRaidVisit(Player player, ViewerSession session) {
        if (!plugin.config().raid().enabled()) {
            return;
        }
        long chunkKey = dev.audismp.aegishider.util.BlockPosUtil.chunkKey(session.worldId(),
                player.getLocation().getBlockX() >> 4, player.getLocation().getBlockZ() >> 4);
        RaidAnalytics.Alert alert = plugin.raidAnalytics().recordChunkEntry(player.getUniqueId(),
                chunkKey, plugin.hiddenBlockIndex(), session.worldId(),
                plugin.config().raid().alertCooldownSeconds());
        if (alert != null) {
            plugin.alertAdmins("§6[Aegishider] §eRaid risk: §f" + alert.summary());
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onTeleport(PlayerTeleportEvent event) {
        Player player = event.getPlayer();
        plugin.getServer().getScheduler().runTask(plugin, () -> {
            if (!player.isOnline()) {
                return;
            }
            handleWorldOrPositionJump(player);
        });
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onChangedWorld(PlayerChangedWorldEvent event) {
        Player player = event.getPlayer();
        plugin.getServer().getScheduler().runTask(plugin, () -> {
            if (player.isOnline()) {
                handleWorldOrPositionJump(player);
            }
        });
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onRespawn(PlayerRespawnEvent event) {
        Player player = event.getPlayer();
        plugin.getServer().getScheduler().runTask(plugin, () -> {
            if (!player.isOnline()) {
                return;
            }
            handleWorldOrPositionJump(player);
        });
    }

    /**
     * Teleport/respawn/world-change: the client entity list is reset and chunks are re-sent,
     * so all reveal markers are dropped (fail-closed) and everything is re-evaluated.
     */
    private void handleWorldOrPositionJump(Player player) {
        ViewerSession session = plugin.sessions().get(player.getUniqueId());
        if (session == null) {
            return;
        }
        long newWorldId = WorldKeys.idOf(player.getWorld());
        boolean worldChanged = session.worldId() != newWorldId;
        if (worldChanged) {
            session.setWorld(player.getWorld());
            session.updateTransform(player.getLocation(), plugin.currentTick());
            session.updateEye(player.getEyeLocation());
            plugin.itemShield().onViewerWorldChanged(session);
            plugin.blockShield().onViewerWorldChanged(session);
            plugin.blockDiscovery().enqueueAround(player.getWorld(),
                    player.getLocation().getBlockX() >> 4, player.getLocation().getBlockZ() >> 4, 3);
        } else {
            session.updateTransform(player.getLocation(), plugin.currentTick());
            session.updateEye(player.getEyeLocation());
            plugin.itemShield().onViewerWorldChanged(session);
            // Same-world jump: do NOT drop reveal markers silently. Re-hide the ones
            // that are now out of keep distance so caching clients cannot replay them.
            plugin.blockShield().onViewerPositionJump(session);
        }
        session.setBypass(player.hasPermission(plugin.config()
                .world(player.getWorld().getName()).bypassPermission()));
        plugin.metrics().setOnlineSessions(plugin.sessions().size());
    }
}
