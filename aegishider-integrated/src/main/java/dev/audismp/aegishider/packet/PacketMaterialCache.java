package dev.audismp.aegishider.packet;

import com.github.retrooper.packetevents.protocol.player.ClientVersion;
import com.github.retrooper.packetevents.protocol.world.states.WrappedBlockState;
import org.bukkit.Material;

import java.util.Collection;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Per-client-version mapping between wire block state ids and material type names.
 *
 * <p>Names are stable across protocol versions ({@code minecraft:chest}); only the numeric
 * state ids differ, so names are used for policy checks and a version-specific filler id
 * is resolved lazily and cached.
 */
public final class PacketMaterialCache implements ChunkSanitizer.StateIdMapper {

    private static final String UNKNOWN = "";

    private static final class VersionCache {
        final ConcurrentHashMap<Material, Integer> fillerIds = new ConcurrentHashMap<>();
        final ConcurrentHashMap<Integer, String> stateNames = new ConcurrentHashMap<>();
    }

    private final ConcurrentHashMap<ClientVersion, VersionCache> versions = new ConcurrentHashMap<>(4);
    private final ConcurrentHashMap<Integer, String> tileEntityNames = new ConcurrentHashMap<>();

    @Override
    public String typeName(ClientVersion version, int stateId) {
        if (stateId <= 0) {
            return null;
        }
        VersionCache cache = versions.computeIfAbsent(version, v -> new VersionCache());
        String cached = cache.stateNames.get(stateId);
        if (cached != null) {
            return cached.isEmpty() ? null : cached;
        }
        String name;
        try {
            WrappedBlockState state = WrappedBlockState.getByGlobalId(version, stateId);
            name = state == null || state.getType() == null ? UNKNOWN : normalize(state.getType().getName());
        } catch (RuntimeException ex) {
            name = UNKNOWN;
        }
        if (name == null) {
            name = UNKNOWN;
        }
        cache.stateNames.put(stateId, name);
        return name.isEmpty() ? null : name;
    }

    @Override
    public String tileEntityTypeName(ClientVersion version, int typeId) {
        if (typeId < 0) {
            return null;
        }
        String cached = tileEntityNames.get(typeId);
        if (cached != null) {
            return cached.isEmpty() ? null : cached;
        }
        String name;
        try {
            var type = com.github.retrooper.packetevents.protocol.world.blockentity.BlockEntityTypes
                    .getById(version, typeId);
            name = type == null || type.getName() == null ? UNKNOWN : normalize(type.getName().toString());
        } catch (RuntimeException ex) {
            name = UNKNOWN;
        }
        if (name == null) {
            name = UNKNOWN;
        }
        tileEntityNames.put(typeId, name);
        return name.isEmpty() ? null : name;
    }

    @Override
    public int fillerStateId(ClientVersion version, Material fillerMaterial) {
        VersionCache cache = versions.computeIfAbsent(version, v -> new VersionCache());
        Integer cached = cache.fillerIds.get(fillerMaterial);
        if (cached != null) {
            return cached;
        }
        int resolved = resolve(version, fillerMaterial);
        if (resolved <= 0) {
            resolved = resolve(version, Material.STONE);
        }
        cache.fillerIds.put(fillerMaterial, resolved);
        return resolved;
    }

    private static int resolve(ClientVersion version, Material material) {
        try {
            String key = "minecraft:" + material.name().toLowerCase(Locale.ROOT);
            WrappedBlockState state = WrappedBlockState.getByString(version, key);
            return state == null ? -1 : state.getGlobalId();
        } catch (RuntimeException ex) {
            return -1;
        }
    }

    /**
     * PacketEvents 2.14 returns the bare state type name (e.g. {@code chest}); strip any
     * namespace prefix so both values compare as bare lowercase material names.
     */
    public static String normalize(String typeName) {
        if (typeName == null) {
            return null;
        }
        if (typeName.startsWith("minecraft:")) {
            return typeName.substring("minecraft:".length());
        }
        int colon = typeName.indexOf(':');
        return colon >= 0 ? typeName.substring(colon + 1) : typeName;
    }

    /**
     * Pre-loads PacketEvents' block-state mappings for the server protocol version and
     * resolves every configured protected material/filler once, so the first player does not
     * pay the ~0.5 s lazy mapping load and the Netty thread does not pay first-use class
     * loading while players are waiting for their chunks.
     *
     * @param version         protocol version of the joining clients (server version)
     * @param bareNames       bare lowercase hidden material names, e.g. {@code chest}
     * @param fillerMaterials configured filler materials
     * @return number of materials resolved via a full name→state→name round trip
     */
    public int warmup(ClientVersion version, Collection<String> bareNames,
                      Collection<Material> fillerMaterials) {
        int resolved = 0;
        try {
            WrappedBlockState stone = WrappedBlockState.getByString(version, "minecraft:stone");
            if (stone != null) {
                WrappedBlockState.getByGlobalId(version, stone.getGlobalId());
                resolved++;
            }
            for (String name : bareNames) {
                WrappedBlockState state = WrappedBlockState.getByString(version, "minecraft:" + name);
                if (state == null) {
                    continue;
                }
                int id = state.getGlobalId();
                WrappedBlockState roundTrip = WrappedBlockState.getByGlobalId(version, id);
                if (roundTrip != null && normalize(roundTrip.getType().getName()) != null) {
                    resolved++;
                }
            }
            for (Material material : fillerMaterials) {
                fillerStateId(version, material);
            }
        } catch (RuntimeException ex) {
            // Warmup is best effort: the lazy paths still work (fail-closed) later.
            return resolved;
        }
        return resolved;
    }

    public void clear() {
        versions.clear();
        tileEntityNames.clear();
    }
}
