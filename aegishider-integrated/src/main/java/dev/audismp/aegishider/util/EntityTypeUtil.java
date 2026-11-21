package dev.audismp.aegishider.util;

import org.bukkit.entity.EntityType;

/** Entity-type classification that does not require a live entity instance. */
public final class EntityTypeUtil {

    private EntityTypeUtil() {
    }

    /**
     * True for every living, non-player entity: monsters, animals, villagers, golems and
     * armor stands. {@link EntityType#isAlive()} is a static property of the enum constant,
     * so this is safe on the packet thread and in unit tests.
     */
    public static boolean isLivingMobType(EntityType type) {
        return type != null
                && type != EntityType.UNKNOWN
                && type != EntityType.PLAYER
                && type.isAlive();
    }
}
