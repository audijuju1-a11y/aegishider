package dev.audismp.aegishider.listener;

import dev.audismp.aegishider.AegishiderPlugin;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.world.ChunkLoadEvent;
import org.bukkit.event.world.ChunkUnloadEvent;

/**
 * Chunk lifecycle.
 *
 * <p>Block discovery is executed synchronously on chunk load: the chunk packet for a
 * player is sent after the chunk became loaded, so the protected-block index must already
 * contain the chunk's containers before that packet is serialized. Doing this lazily on
 * the next tick would leak the real chunk once.
 *
 * <p>Protected block data is NOT evicted on chunk unload: the blocks still exist in the
 * world and will be re-sent when the chunk loads again. Eviction only happens on world
 * unload. (The previous implementation destroyed its hidden-block index on every chunk
 * unload - a permanent protection loss.)
 */
public final class ChunkListener implements Listener {

    private final AegishiderPlugin plugin;

    public ChunkListener(AegishiderPlugin plugin) {
        this.plugin = plugin;
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onChunkLoad(ChunkLoadEvent event) {
        if (!plugin.config().isWorldEnabled(event.getWorld().getName())) {
            return;
        }
        plugin.blockDiscovery().discoverChunkNow(event.getWorld(),
                event.getChunk().getX(), event.getChunk().getZ());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onChunkUnload(ChunkUnloadEvent event) {
        long worldId = dev.audismp.aegishider.core.WorldKeys.idOf(event.getWorld());
        long chunkKey = dev.audismp.aegishider.util.BlockPosUtil.chunkKey(worldId,
                event.getChunk().getX(), event.getChunk().getZ());
        plugin.raidAnalytics().evictChunk(chunkKey);
        // Intentionally NOT evicting plugin.hiddenBlockIndex(): the blocks still exist.
    }
}
