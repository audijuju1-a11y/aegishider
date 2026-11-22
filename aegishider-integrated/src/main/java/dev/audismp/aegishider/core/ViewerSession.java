package dev.audismp.aegishider.core;

import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Player;

import java.util.UUID;

/**
 * Per-viewer state.
 *
 * <p>Threading contract:
 * <ul>
 *   <li>Main thread owns transform, world and engine caches and may write all fields.</li>
 *   <li>The packet thread (Netty) only reads the volatile fields
 *       ({@link #worldId()}, {@link #previousWorldId()}, {@link #bypass()}).</li>
 * </ul>
 *
 * <p>World identity is fail-closed: when a viewer is unknown (id 0) the packet layer
 * must treat every protected object as hidden. During a world transition the previous
 * world id is checked as well for a short window, so a chunk packet that races the
 * Bukkit world-change event cannot leak a base from the new world.
 */
public final class ViewerSession {

    private static final long WORLD_TRANSITION_WINDOW_MS = 10_000L;

    private final UUID playerId;
    private final Player player;
    private final long joinTick;

    private volatile long worldId = WorldKeys.UNKNOWN;
    private volatile long previousWorldId = WorldKeys.UNKNOWN;
    private volatile long worldTransitionUntilMs;
    private volatile boolean bypass;
    /** World name and section origin used by the packet thread for chunk sanitization. */
    private volatile String worldName = "";
    private volatile String previousWorldName = "";
    private volatile int minSectionY;

    // Transform snapshot. Written on the main thread; eyeY/chunkX/chunkZ are read by the
    // packet thread, so every field is volatile for safe publication.
    private volatile double eyeX;
    private volatile double eyeY;
    private volatile double eyeZ;
    private volatile double lookX;
    private volatile double lookY;
    private volatile double lookZ;
    private volatile double x;
    private volatile double y;
    private volatile double z;
    private volatile int blockX;
    private volatile int blockY;
    private volatile int blockZ;
    private volatile float yaw;
    private volatile float pitch;

    /** Incremented on significant movement/look/world changes; invalidates engine caches. */
    private volatile long revision;
    /** Incremented when the player changed chunk (used for bookkeeping). */
    private volatile long chunkRevision;
    private volatile int chunkX;
    private volatile int chunkZ;
    /** True when the last main-thread decision put this viewer above the Y-shield line. */
    private volatile boolean yShieldMasked;
    /** Last tick this session's transform was refreshed. */
    private int lastTransformTick;

    public ViewerSession(Player player, long joinTick) {
        this.playerId = player.getUniqueId();
        this.player = player;
        this.joinTick = joinTick;
        updateTransform(player.getLocation(), 0);
        setWorld(player.getWorld());
    }

    // ── Packet-thread visible state ────────────────────────────────────────

    public UUID playerId() { return playerId; }
    public Player player() { return player; }
    public long joinTick() { return joinTick; }
    public long worldId() { return worldId; }
    public long previousWorldId() { return previousWorldId; }
    public boolean bypass() { return bypass; }
    public String worldName() { return worldName; }
    public String previousWorldName() { return previousWorldName; }
    public int minSectionY() { return minSectionY; }

    public boolean isWorldTransitionActive() {
        return worldTransitionUntilMs > 0 && System.currentTimeMillis() <= worldTransitionUntilMs;
    }

    /** Returns true if this session's world id is safe to use for packet decisions. */
    public boolean isWorldKnown() {
        return worldId != WorldKeys.UNKNOWN;
    }

    // ── Main-thread state ──────────────────────────────────────────────────

    public void setWorld(World world) {
        long newWorldId = WorldKeys.idOf(world);
        long old = worldId;
        String oldName = worldName;
        worldName = world.getName();
        minSectionY = world.getMinHeight() >> 4;
        if (old == newWorldId) {
            worldId = newWorldId;
            return;
        }
        previousWorldId = old;
        previousWorldName = oldName;
        worldId = newWorldId;
        worldTransitionUntilMs = System.currentTimeMillis() + WORLD_TRANSITION_WINDOW_MS;
        revision++;
    }

    public void setBypass(boolean bypass) {
        if (this.bypass != bypass) {
            this.bypass = bypass;
            revision++;
        }
    }

    /**
     * Refreshes the transform snapshot. Returns true when the change is significant
     * enough to invalidate visibility caches (block change, large movement, big look
     * change, chunk change).
     */
    public boolean updateTransform(Location loc, int tick) {
        double nx = loc.getX();
        double ny = loc.getY();
        double nz = loc.getZ();
        float nyaw = loc.getYaw();
        float npitch = loc.getPitch();
        int nbx = loc.getBlockX();
        int nby = loc.getBlockY();
        int nbz = loc.getBlockZ();
        int ncx = nbx >> 4;
        int ncz = nbz >> 4;

        boolean chunkChanged = ncx != chunkX || ncz != chunkZ;
        boolean blockChanged = nbx != blockX || nby != blockY || nbz != blockZ;
        double movedSq = (nx - x) * (nx - x) + (ny - y) * (ny - y) + (nz - z) * (nz - z);
        boolean significantMove = chunkChanged || blockChanged || movedSq >= 4.0;
        float yawDelta = Math.abs(wrapDegrees(nyaw - yaw));
        float pitchDelta = Math.abs(npitch - pitch);
        boolean significantLook = yawDelta >= 15.0f || pitchDelta >= 15.0f;

        x = nx; y = ny; z = nz;
        yaw = nyaw; pitch = npitch;
        blockX = nbx; blockY = nby; blockZ = nbz;
        eyeX = nx;
        // Stand-in eye height; engines refresh the exact eye position with
        // Player#getEyeLocation() via updateEye() on join and every evaluated tick.
        eyeY = ny + 1.62;
        eyeZ = nz;
        lookX = -Math.sin(Math.toRadians(nyaw)) * Math.cos(Math.toRadians(npitch));
        lookY = -Math.sin(Math.toRadians(npitch));
        lookZ = Math.cos(Math.toRadians(nyaw)) * Math.cos(Math.toRadians(npitch));
        lastTransformTick = tick;
        chunkX = ncx;
        chunkZ = ncz;
        if (chunkChanged) {
            chunkRevision++;
        }
        if (significantMove || significantLook) {
            revision++;
            return true;
        }
        return false;
    }

    /** Explicit eye position update (player.getEyeLocation is authoritative). */
    public void updateEye(Location eye) {
        eyeX = eye.getX();
        eyeY = eye.getY();
        eyeZ = eye.getZ();
        lookX = eye.getDirection().getX();
        lookY = eye.getDirection().getY();
        lookZ = eye.getDirection().getZ();
    }

    private static float wrapDegrees(float degrees) {
        float d = degrees % 360.0f;
        if (d >= 180.0f) d -= 360.0f;
        if (d < -180.0f) d += 360.0f;
        return d;
    }

    // ── Getters ────────────────────────────────────────────────────────────

    public double x() { return x; }
    public double y() { return y; }
    public double z() { return z; }
    public double eyeX() { return eyeX; }
    public double eyeY() { return eyeY; }
    public double eyeZ() { return eyeZ; }
    public double lookX() { return lookX; }
    public double lookY() { return lookY; }
    public double lookZ() { return lookZ; }
    public int blockX() { return blockX; }
    public int blockY() { return blockY; }
    public int blockZ() { return blockZ; }
    public int chunkX() { return chunkX; }
    public int chunkZ() { return chunkZ; }
    public float yaw() { return yaw; }
    public float pitch() { return pitch; }
    public long revision() { return revision; }
    public long chunkRevision() { return chunkRevision; }
    public int lastTransformTick() { return lastTransformTick; }
    public boolean yShieldMasked() { return yShieldMasked; }

    public void setYShieldMasked(boolean yShieldMasked) {
        this.yShieldMasked = yShieldMasked;
    }

    @Override
    public String toString() {
        return "ViewerSession{" + playerId + ", world=" + worldId + ", rev=" + revision + '}';
    }
}
