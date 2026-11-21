package dev.audismp.aegishider.index;

import dev.audismp.aegishider.util.MaterialSets;

import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;

import java.util.EnumMap;
import java.util.Map;
import java.util.Set;

/**
 * Chooses a client-side filler material that looks like the protected block's surroundings
 * instead of a single global stone block. This only changes what the client receives; the
 * real block is never modified on the server.
 *
 * <p>Rules:
 * <ol>
 *   <li>Never choose a configured protected material (would mimic another container).</li>
 *   <li>Prefer the block below when it is solid (surface chests on grass get grass, cave
 *       chests on stone get stone, base chests on wood get wood).</li>
 *   <li>Otherwise use the most common solid neighbour material (walls/floors), ties prefer
 *       the block below.</li>
 *   <li>Fall back to the configured fixed filler (normally STONE) when nothing matches.</li>
 * </ol>
 */
public final class FillerChooser {

    private static final BlockFace[] SIDES = {
            BlockFace.NORTH, BlockFace.SOUTH, BlockFace.EAST, BlockFace.WEST,
            BlockFace.UP, BlockFace.DOWN
    };

    private FillerChooser() {
    }

    /** Main-thread entry point; {@code world} and the block position must be loaded. */
    public static Material choose(World world, int x, int y, int z,
                                  Set<Material> hiddenMaterials, Material fallback) {
        Block block = world.getBlockAt(x, y, z);
        Block above = block.getRelative(BlockFace.UP);
        Block below = block.getRelative(BlockFace.DOWN);
        Material[] neighbours = new Material[4];
        int index = 0;
        for (BlockFace face : new BlockFace[]{BlockFace.NORTH, BlockFace.SOUTH,
                BlockFace.EAST, BlockFace.WEST}) {
            neighbours[index++] = block.getRelative(face).getType();
        }
        return chooseFrom(above.getType(), below.getType(), neighbours, hiddenMaterials, fallback);
    }

    /** Pure decision helper (unit-testable). */
    public static Material chooseFrom(Material above, Material below, Material[] neighbours,
                                      Set<Material> hiddenMaterials, Material fallback) {
        Material safeFallback = isUsable(fallback, hiddenMaterials) ? fallback : Material.STONE;
        boolean exposedAbove = above == null || !above.isSolid() || above.isAir();
        Material ground = isUsable(below, hiddenMaterials) && below.isSolid() ? below : null;

        if (exposedAbove && ground != null) {
            // Surface-placed container: use the ground material (grass/dirt/sand/stone...)
            // so it does not become a floating stone cube.
            return ground;
        }

        Map<Material, Integer> counts = new EnumMap<>(Material.class);
        if (ground != null) {
            counts.merge(ground, 1, Integer::sum);
        }
        if (neighbours != null) {
            for (Material neighbour : neighbours) {
                if (isUsable(neighbour, hiddenMaterials) && neighbour.isSolid()) {
                    counts.merge(neighbour, 1, Integer::sum);
                }
            }
        }
        Material best = null;
        int bestCount = -1;
        for (Map.Entry<Material, Integer> entry : counts.entrySet()) {
            int count = entry.getValue();
            if (count > bestCount) {
                best = entry.getKey();
                bestCount = count;
            } else if (count == bestCount && best != null && entry.getKey() == ground) {
                best = entry.getKey(); // tie: prefer the ground directly below
            }
        }
        return best == null ? safeFallback : best;
    }

    private static boolean isUsable(Material material, Set<Material> hiddenMaterials) {
        if (material == null || material.isAir() || !material.isSolid() || material.isLegacy()) {
            return false;
        }
        if (material == Material.WATER || material == Material.LAVA
                || material == Material.BUBBLE_COLUMN) {
            return false; // liquids are never a plausible solid filler
        }
        if (material.isOccluding() == false) {
            return false;
        }
        if (MaterialSets.isDiscoverableBlockEntityMaterial(material)) {
            return false; // never fake a chest with a sign/banner: the client would create a block entity
        }
        return hiddenMaterials == null || !hiddenMaterials.contains(material);
    }
}
