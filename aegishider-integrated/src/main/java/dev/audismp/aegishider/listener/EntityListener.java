package dev.audismp.aegishider.listener;

import com.destroystokyo.paper.event.entity.EntityRemoveFromWorldEvent;
import dev.audismp.aegishider.AegishiderPlugin;
import org.bukkit.entity.Entity;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.CreatureSpawnEvent;
import org.bukkit.event.entity.EntitySpawnEvent;
import org.bukkit.event.entity.ItemSpawnEvent;
import org.bukkit.event.entity.ItemMergeEvent;
import org.bukkit.event.world.EntitiesLoadEvent;
import org.bukkit.event.world.EntitiesUnloadEvent;

/**
 * EntityShield registration lifecycle.
 *
 * <p>Registration happens synchronously, before the entity tracker can send any packet:
 * {@link EntitySpawnEvent} for newly spawned entities and {@link EntitiesLoadEvent} for
 * entities restored from disk. Registration itself calls
 * {@code Entity#setVisibleByDefault(false)}, which is the fail-closed primitive: the
 * tracker will not send a spawn/update packet until the visibility engine explicitly
 * shows the entity to a specific viewer.
 */
public final class EntityListener implements Listener {

    private final AegishiderPlugin plugin;

    public EntityListener(AegishiderPlugin plugin) {
        this.plugin = plugin;
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onEntitySpawn(EntitySpawnEvent event) {
        plugin.itemShield().onEntityAvailable(event.getEntity());
    }

    /**
     * Mobs fire {@link CreatureSpawnEvent}, which also has its own HandlerList. Without
     * this handler every hostile mob stayed fail-closed invisible: the packet gateway
     * cancelled its spawn because ItemShield had no registration for it.
     */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onCreatureSpawn(CreatureSpawnEvent event) {
        plugin.itemShield().onEntityAvailable(event.getEntity());
    }

    /**
     * Items fire {@link ItemSpawnEvent} (a subclass of EntitySpawnEvent with its own
     * HandlerList), so a listener for the base class does NOT receive them. This was the
     * cause of the legacy-build item ESP leak: items were never registered and therefore
     * never hidden-by-default.
     */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onItemSpawn(ItemSpawnEvent event) {
        plugin.itemShield().onEntityAvailable(event.getEntity());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onEntitiesLoad(EntitiesLoadEvent event) {
        for (Entity entity : event.getEntities()) {
            plugin.itemShield().onEntityAvailable(entity);
        }
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onEntitiesUnload(EntitiesUnloadEvent event) {
        for (Entity entity : event.getEntities()) {
            plugin.itemShield().onEntityRemoved(entity);
        }
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onEntityRemove(EntityRemoveFromWorldEvent event) {
        plugin.itemShield().onEntityRemoved(event.getEntity());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onItemMerge(ItemMergeEvent event) {
        // The merged stack's item-stack metadata changes; re-evaluate visibility.
        plugin.itemShield().onEntityChanged(event.getTarget());
        plugin.itemShield().onEntityChanged(event.getEntity());
    }
}
