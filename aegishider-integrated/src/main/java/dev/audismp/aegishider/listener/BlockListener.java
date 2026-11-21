package dev.audismp.aegishider.listener;

import dev.audismp.aegishider.AegishiderPlugin;
import dev.audismp.aegishider.config.WorldSettings;
import dev.audismp.aegishider.core.WorldKeys;
import dev.audismp.aegishider.index.FillerChooser;
import dev.audismp.aegishider.util.BlockPosUtil;
import org.bukkit.Location;
import org.bukkit.block.Block;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockBurnEvent;
import org.bukkit.event.block.BlockExplodeEvent;
import org.bukkit.event.block.BlockFadeEvent;
import org.bukkit.event.block.BlockPistonExtendEvent;
import org.bukkit.event.block.BlockPistonRetractEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.EntityExplodeEvent;

import java.util.List;

/**
 * Maintains the protected block index from real world events.
 *
 * <p>This is the primary maintenance path (fast, event-driven). The reconciliation sweep
 * in {@code BlockDiscovery} is the safety net for changes that bypass Bukkit events.
 */
public final class BlockListener implements Listener {

    private final AegishiderPlugin plugin;

    public BlockListener(AegishiderPlugin plugin) {
        this.plugin = plugin;
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBlockPlace(BlockPlaceEvent event) {
        Block block = event.getBlock();
        WorldSettings settings = plugin.config().world(block.getWorld().getName());
        if (!settings.blocksEnabled()) {
            return;
        }
        if (!settings.blockProtection().isHiddenMaterial(block.getType())) {
            return;
        }
        long worldId = WorldKeys.idOf(block.getWorld());
        long pos = BlockPosUtil.encode(block.getX(), block.getY(), block.getZ());
        plugin.hiddenBlockIndex().register(worldId, pos);
        if (settings.blockProtection().contextualFiller()) {
            plugin.hiddenBlockIndex().setFiller(worldId, pos, FillerChooser.choose(
                    block.getWorld(), block.getX(), block.getY(), block.getZ(),
                    settings.blockProtection().hiddenMaterials(),
                    settings.blockProtection().replaceWith()));
        }
        plugin.blockShield().onOcclusionChanged(block.getWorld(), block.getX(), block.getY(), block.getZ());
        plugin.tunnelShield().removeAt(block.getWorld(), block);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBlockBreak(BlockBreakEvent event) {
        Block block = event.getBlock();
        long worldId = WorldKeys.idOf(block.getWorld());
        long pos = BlockPosUtil.encode(block.getX(), block.getY(), block.getZ());
        if (plugin.hiddenBlockIndex().unregister(worldId, pos)) {
            plugin.blockShield().onOcclusionChanged(block.getWorld(), block.getX(), block.getY(), block.getZ());
        }
        plugin.tunnelShield().recordBreak(block.getWorld(), block, plugin.config().world(block.getWorld().getName()));
        plugin.recordMining(event);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBlockExplode(BlockExplodeEvent event) {
        removeAll(event.blockList());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onEntityExplode(EntityExplodeEvent event) {
        removeAll(event.blockList());
    }

    private void removeAll(List<Block> blocks) {
        if (blocks.isEmpty()) {
            return;
        }
        for (Block block : blocks) {
            long worldId = WorldKeys.idOf(block.getWorld());
            long pos = BlockPosUtil.encode(block.getX(), block.getY(), block.getZ());
            if (plugin.hiddenBlockIndex().unregister(worldId, pos)) {
                plugin.blockShield().onOcclusionChanged(block.getWorld(),
                        block.getX(), block.getY(), block.getZ());
            }
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBlockBurn(BlockBurnEvent event) {
        Block block = event.getBlock();
        long worldId = WorldKeys.idOf(block.getWorld());
        long pos = BlockPosUtil.encode(block.getX(), block.getY(), block.getZ());
        if (plugin.hiddenBlockIndex().unregister(worldId, pos)) {
            plugin.blockShield().onOcclusionChanged(block.getWorld(), block.getX(), block.getY(), block.getZ());
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBlockFade(BlockFadeEvent event) {
        Block block = event.getBlock();
        long worldId = WorldKeys.idOf(block.getWorld());
        long pos = BlockPosUtil.encode(block.getX(), block.getY(), block.getZ());
        if (plugin.hiddenBlockIndex().unregister(worldId, pos)) {
            plugin.blockShield().onOcclusionChanged(block.getWorld(), block.getX(), block.getY(), block.getZ());
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPistonExtend(BlockPistonExtendEvent event) {
        rescanMovedBlocks(event.getBlock(), event.getBlocks());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPistonRetract(BlockPistonRetractEvent event) {
        rescanMovedBlocks(event.getBlock(), event.getBlocks());
    }

    private void rescanMovedBlocks(Block piston, List<Block> moved) {
        // Protected blocks are block-entity containers and cannot be pushed by pistons,
        // but a piston can move a block into/out of a container's line of sight, so the
        // affected chunks are re-discovered on the next sweep.
        Location location = piston.getLocation();
        plugin.blockDiscovery().enqueue(piston.getWorld(),
                location.getBlockX() >> 4, location.getBlockZ() >> 4);
        plugin.blockShield().onOcclusionChanged(piston.getWorld(),
                location.getBlockX(), location.getBlockY(), location.getBlockZ());
        plugin.itemShield().onBlockChanged(piston.getWorld(),
                location.getBlockX(), location.getBlockY(), location.getBlockZ());
    }
}
