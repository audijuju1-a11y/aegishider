package dev.audismp.aegishider.core;

import org.bukkit.entity.Player;

import java.util.Collection;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Single source of truth for online viewer sessions.
 * Main thread creates/removes sessions; Netty reads them by UUID (O(1), lock free).
 */
public final class SessionRegistry {

    private final ConcurrentHashMap<UUID, ViewerSession> sessions = new ConcurrentHashMap<>();

    public ViewerSession create(Player player, long tick) {
        ViewerSession session = new ViewerSession(player, tick);
        sessions.put(player.getUniqueId(), session);
        return session;
    }

    public ViewerSession get(UUID playerId) {
        return sessions.get(playerId);
    }

    public void remove(UUID playerId) {
        sessions.remove(playerId);
    }

    public Collection<ViewerSession> all() {
        return sessions.values();
    }

    public int size() {
        return sessions.size();
    }
}
