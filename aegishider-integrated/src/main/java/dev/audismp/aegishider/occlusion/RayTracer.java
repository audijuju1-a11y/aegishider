package dev.audismp.aegishider.occlusion;

import org.bukkit.World;

/**
 * Abstraction over a voxel line-of-sight check so engines and tests do not need a
 * running Bukkit world. Production implementation is {@link PaperRayTracer}.
 */
@FunctionalInterface
public interface RayTracer {

    /**
     * @return true when solid, non-transparent geometry blocks the straight line between
     *         the two points (the target itself is not considered: callers stop the ray
     *         slightly before the target).
     */
    boolean isOccluded(World world,
                       double eyeX, double eyeY, double eyeZ,
                       double targetX, double targetY, double targetZ);

    /**
     * Block-target variant: a ray that reaches the target block must count as
     * <b>not occluded</b> (the target's own collision shape is not an occluder). This is
     * required for chest/container reveal: otherwise the ray hits the chest itself and the
     * block is hidden forever.
     */
    default boolean isOccluded(World world,
                               double eyeX, double eyeY, double eyeZ,
                               double targetX, double targetY, double targetZ,
                               int targetBlockX, int targetBlockY, int targetBlockZ) {
        return isOccluded(world, eyeX, eyeY, eyeZ, targetX, targetY, targetZ);
    }
}
