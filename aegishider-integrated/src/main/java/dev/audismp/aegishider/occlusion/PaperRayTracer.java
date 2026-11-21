package dev.audismp.aegishider.occlusion;

import dev.audismp.aegishider.config.AegishiderConfig;
import dev.audismp.aegishider.metrics.Metrics;
import org.bukkit.FluidCollisionMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.util.RayTraceResult;
import org.bukkit.util.Vector;

import java.util.Set;
import java.util.function.Supplier;

/**
 * Occlusion using Paper's native block ray trace (accurate collision shapes, fast C++
 * style voxel traversal in NMS) with explicit handling of see-through materials.
 *
 * <p>Fluid handling: only fluid <b>source</b> blocks are visible to the trace. Water is
 * treated as transparent (players see through water in vanilla) and the ray continues;
 * lava is not transparent, so it correctly occludes.
 *
 * <p>Fail-closed: if the ray does not resolve within the configured number of
 * transparent segments, the result is "occluded" (hidden), never "visible".
 */
public final class PaperRayTracer implements RayTracer {

    /** Stop just before the requested target point so we never hit the target itself. */
    private static final double STOP_BEFORE_TARGET = 0.05;
    private static final double MIN_STEP = 1.0e-3;

    private final Supplier<AegishiderConfig> config;
    private final Metrics metrics;

    public PaperRayTracer(Supplier<AegishiderConfig> config, Metrics metrics) {
        this.config = config;
        this.metrics = metrics;
    }

    @Override
    public boolean isOccluded(World world,
                              double eyeX, double eyeY, double eyeZ,
                              double targetX, double targetY, double targetZ) {
        return isOccluded(world, eyeX, eyeY, eyeZ, targetX, targetY, targetZ,
                Integer.MIN_VALUE, Integer.MIN_VALUE, Integer.MIN_VALUE);
    }

    @Override
    public boolean isOccluded(World world,
                              double eyeX, double eyeY, double eyeZ,
                              double targetX, double targetY, double targetZ,
                              int targetBlockX, int targetBlockY, int targetBlockZ) {
        double dx = targetX - eyeX;
        double dy = targetY - eyeY;
        double dz = targetZ - eyeZ;
        double distanceSq = dx * dx + dy * dy + dz * dz;
        if (distanceSq < 1.0e-6) {
            return false;
        }
        double distance = Math.sqrt(distanceSq);
        double remaining = distance - STOP_BEFORE_TARGET;
        if (remaining <= 0.0) {
            return false;
        }
        double dirX = dx / distance;
        double dirY = dy / distance;
        double dirZ = dz / distance;

        AegishiderConfig current = config.get();
        Set<Material> transparent = current.transparentBlocks();
        int maxSegments = current.maxRaycastSegments();

        double startX = eyeX;
        double startY = eyeY;
        double startZ = eyeZ;
        Vector direction = new Vector(dirX, dirY, dirZ);

        for (int segment = 0; segment < maxSegments; segment++) {
            if (metrics != null) {
                metrics.recordRaycast();
            }
            RayTraceResult result = world.rayTraceBlocks(
                    new Location(world, startX, startY, startZ), direction, remaining,
                    FluidCollisionMode.SOURCE_ONLY, true);
            if (result == null) {
                return false;
            }
            Block hit = result.getHitBlock();
            if (hit == null) {
                return false;
            }
            if (hit.getX() == targetBlockX && hit.getY() == targetBlockY
                    && hit.getZ() == targetBlockZ) {
                // The ray reached the protected block itself: its own hitbox is not an
                // occluder. Treat it as visible instead of hiding it forever.
                return false;
            }
            Material type = hit.getType();
            if (!transparent.contains(type)) {
                return true;
            }
            // The ray passed through a see-through block (glass, water, ice, ...).
            // Advance the start point to just outside that block's voxel and continue.
            double exit = exitDistance(startX, startY, startZ, dirX, dirY, dirZ,
                    hit.getX(), hit.getY(), hit.getZ());
            if (Double.isNaN(exit) || exit <= MIN_STEP) {
                return true; // defensively treat as occluded
            }
            double advance = exit + MIN_STEP;
            startX += dirX * advance;
            startY += dirY * advance;
            startZ += dirZ * advance;
            remaining -= advance;
            if (remaining <= 0.0) {
                return false;
            }
        }
        // Too many transparent layers: do not risk a false reveal.
        return true;
    }

    /** Distance along the ray until it leaves the given unit voxel. */
    private static double exitDistance(double startX, double startY, double startZ,
                                       double dirX, double dirY, double dirZ,
                                       int blockX, int blockY, int blockZ) {
        double tX = axisExit(startX, dirX, blockX);
        double tY = axisExit(startY, dirY, blockY);
        double tZ = axisExit(startZ, dirZ, blockZ);
        double exit = Math.min(tX, Math.min(tY, tZ));
        return exit;
    }

    private static double axisExit(double start, double direction, int blockCoordinate) {
        if (direction > 1.0e-9) {
            return (blockCoordinate + 1.0 - start) / direction;
        }
        if (direction < -1.0e-9) {
            return (blockCoordinate - start) / direction;
        }
        return Double.MAX_VALUE;
    }
}
