package dev.audismp.aegishider.core;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertSame;

class WorldKeysTest {

    @AfterEach
    void cleanup() {
        WorldKeys.resetForTests();
    }

    @Test
    void internsWorldUuidToStableUniqueId() {
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        long firstId = WorldKeys.idOf(first);
        long secondId = WorldKeys.idOf(second);
        assertNotEquals(WorldKeys.UNKNOWN, firstId);
        assertNotEquals(WorldKeys.UNKNOWN, secondId);
        assertNotEquals(firstId, secondId);
        assertEquals(firstId, WorldKeys.idOf(first));
        assertEquals(secondId, WorldKeys.idOf(second));
        assertEquals(first, WorldKeys.uuidOf(firstId));
        assertSame(second, WorldKeys.uuidOf(secondId));
    }

    @Test
    void exhaustionDegradesToUnknownInsteadOfThrowing() throws Exception {
        Field next = WorldKeys.class.getDeclaredField("NEXT");
        next.setAccessible(true);
        ((AtomicLong) next.get(null)).set(0xFFFFFL);

        long last = WorldKeys.idOf(UUID.randomUUID());
        assertEquals(0xFFFFFL, last);
        assertEquals(WorldKeys.UNKNOWN, WorldKeys.idOf(UUID.randomUUID()));
        assertEquals(WorldKeys.UNKNOWN, WorldKeys.idOf(UUID.randomUUID()));
    }
}
