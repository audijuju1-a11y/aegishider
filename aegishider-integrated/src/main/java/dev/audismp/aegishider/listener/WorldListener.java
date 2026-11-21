package dev.audismp.aegishider.listener;

import dev.audismp.aegishider.AegishiderPlugin;
import dev.audismp.aegishider.core.WorldKeys;
import org.bukkit.World;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.world.WorldLoadEvent;
import org.bukkit.event.world.WorldUnloadEvent;

/**
 * World lifecycle: protected block data is world derived, so it is safe to evict on world
 * unload and must be re-discovered on world load.
 */
public final class WorldListener implements Listener {

    private final AegishiderPlugin plugin;

    public WorldListener(AegishiderPlugin plugin) {
        this.plugin = plugin;
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onWorldLoad(WorldLoadEvent event) {
        World world = event.getWorld();
        if (!plugin.config().isWorldEnabled(world.getName())) {
            return;
        }
        plugin.blockDiscovery().enqueueSpawnArea(world);
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onWorldUnload(WorldUnloadEvent event) {
        long worldId = WorldKeys.idOf(event.getWorld());
        plugin.hiddenBlockIndex().evictWorld(worldId);
        plugin.blockShield().onViewerWorldChangedForAll();
        plugin.getLogger().info("Aegishider: evicted protected-block data for unloaded world "
                + event.getWorld().getName());
    }
}
