package dev.audismp.aegishider.core;

import org.bukkit.World;

import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.logging.Logger;

/**
 * Interns loaded worlds to a small numeric id so that every cross-world cache key
 * (block index, chunk packets, reveal state) is collision free.
 *
 * <p>Ids are allocated sequentially per JVM/plugin-classloader. A world keeps the
 * same id for the lifetime of the server process, including after an unload/reload
 * of the same world UUID. Id {@code 0} is reserved for "unknown world" and must
 * always be treated as HIDDEN/fail-closed by the packet layer.
 */
public final class WorldKeys {

    public static final long UNKNOWN = 0L;
    private static final long MAX_WORLD_ID = 0xF_FFFFL;

    private static final AtomicLong NEXT = new AtomicLong(1L);
    private static final AtomicBoolean EXHAUSTION_LOGGED = new AtomicBoolean(false);
    private static final ConcurrentHashMap<UUID, Long> BY_UUID = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<Long, UUID> BY_ID = new ConcurrentHashMap<>();

    private WorldKeys() {
    }

    public static long idOf(World world) {
        return idOf(world.getUID());
    }

    public static long idOf(UUID worldUuid) {
        Long existing = BY_UUID.get(worldUuid);
        if (existing != null) {
            return existing;
        }
        long id = NEXT.getAndIncrement();
        if (id > MAX_WORLD_ID) {
            // Never fail the hot path: map the world to UNKNOWN so every caller keeps the
            // fail-closed behaviour (unknown worlds stay hidden) and log exactly once.
            if (EXHAUSTION_LOGGED.compareAndSet(false, true)) {
                Logger.getLogger("Aegishider").warning("Aegishider exhausted its world-id space (max "
                        + MAX_WORLD_ID + "); additional worlds are treated as UNKNOWN (fail-closed).");
            }
            return UNKNOWN;
        }
        Long race = BY_UUID.putIfAbsent(worldUuid, id);
        if (race != null) {
            return race;
        }
        BY_ID.put(id, worldUuid);
        return id;
    }

    public static UUID uuidOf(long id) {
        return BY_ID.get(id);
    }

    /** Test/reload helper. Never call while the server is running. */
    public static void resetForTests() {
        NEXT.set(1L);
        EXHAUSTION_LOGGED.set(false);
        BY_UUID.clear();
        BY_ID.clear();
    }
}
