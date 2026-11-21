package dev.audismp.aegishider.detection;

import dev.audismp.aegishider.index.HiddenBlockIndex;

import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Optional raid analytics: detects several distinct players suddenly converging on a
 * chunk that contains protected blocks.
 *
 * <p>DETECTION ONLY - no enforcement, no auto-ban, explicit cooldown, bounded memory.
 * All state is main-thread only and evicted on chunk unload / world unload.
 */
public final class RaidAnalytics {

    private static final int SURGE_PLAYERS = 3;
    private static final long WINDOW_MS = 30_000L;
    private static final int MAX_TRACKED_CHUNKS = 4096;

    private static final class ChunkVisits {
        final Map<UUID, Long> lastVisit = new HashMap<>(4);
        long lastAlertMs;
    }

    private final LinkedHashMap<Long, ChunkVisits> visits = new LinkedHashMap<>(256, 0.75f, true);

    public record Alert(long chunkKey, int visitors, String summary) {
    }

    /**
     * Records a player entering a chunk.
     *
     * @return an alert when a surge is detected on a sensitive chunk, otherwise null
     */
    public Alert recordChunkEntry(UUID player, long chunkKey, HiddenBlockIndex index,
                                  long worldId, int alertCooldownSeconds) {
        if (index.chunkView(worldId, chunkKeyX(chunkKey), chunkKeyZ(chunkKey)) == null) {
            return null; // only alert for chunks that actually contain protected blocks
        }
        ChunkVisits chunk = visits.get(chunkKey);
        if (chunk == null) {
            if (visits.size() >= MAX_TRACKED_CHUNKS) {
                Iterator<Long> eldest = visits.keySet().iterator();
                if (eldest.hasNext()) {
                    eldest.next();
                    eldest.remove();
                }
            }
            chunk = new ChunkVisits();
            visits.put(chunkKey, chunk);
        }
        long now = System.currentTimeMillis();
        chunk.lastVisit.put(player, now);
        chunk.lastVisit.entrySet().removeIf(entry -> now - entry.getValue() > WINDOW_MS);
        int visitors = chunk.lastVisit.size();
        if (visitors < SURGE_PLAYERS) {
            return null;
        }
        if (now - chunk.lastAlertMs < alertCooldownSeconds * 1000L) {
            return null;
        }
        chunk.lastAlertMs = now;
        return new Alert(chunkKey, visitors, visitors + " players within 30s at chunk "
                + chunkKeyX(chunkKey) + "," + chunkKeyZ(chunkKey));
    }

    public void evictChunk(long chunkKey) {
        visits.remove(chunkKey);
    }

    public void clear() {
        visits.clear();
    }

    public int trackedChunks() {
        return visits.size();
    }

    private static int chunkKeyX(long chunkKey) {
        return dev.audismp.aegishider.util.BlockPosUtil.chunkXOf(chunkKey);
    }

    private static int chunkKeyZ(long chunkKey) {
        return dev.audismp.aegishider.util.BlockPosUtil.chunkZOf(chunkKey);
    }
}
