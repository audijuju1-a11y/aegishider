package dev.audismp.aegishider.platform;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class JsonTest {

    @Test
    void parsesObjectsArraysAndScalars() {
        Object parsed = Json.parse("""
                {"name":"Aegishider","count":38,"active":true,"ratio":0.5,
                 "nested":{"items":["a","b",null]},"missing":null}
                """);
        Map<String, Object> object = Json.asObject(parsed);
        assertEquals("Aegishider", object.get("name"));
        assertEquals(38L, object.get("count"));
        assertEquals(true, object.get("active"));
        assertEquals(0.5d, object.get("ratio"));
        List<Object> items = Json.asArray(Json.asObject(object.get("nested")).get("items"));
        assertEquals(List.of("a", "b"), items.subList(0, 2));
        assertNull(items.get(2));
    }

    @Test
    void handlesEscapesAndUnicode() {
        Map<String, Object> object = Json.asObject(Json.parse("{\"text\":\"line\\nquote\\\"tab\\t\\\\\"}"));
        assertEquals("line\nquote\"tab\t\\", object.get("text"));
    }

    @Test
    void stringifyRoundTrips() {
        Map<String, Object> original = Json.object(
                "plugin_version", "3.3.0",
                "metrics", Json.object("tps", 19.96, "players_online", 12L),
                "modules", List.of("block-protection", "item-shield"));
        String encoded = Json.stringify(original);
        Map<String, Object> decoded = Json.asObject(Json.parse(encoded));
        assertEquals("3.3.0", decoded.get("plugin_version"));
        assertEquals(19.96d, Json.asObject(decoded.get("metrics")).get("tps"));
        assertInstanceOf(List.class, decoded.get("modules"));
    }

    @Test
    void rejectsMalformedJson() {
        assertThrows(IllegalArgumentException.class, () -> Json.parse("{\"a\":}"));
        assertThrows(IllegalArgumentException.class, () -> Json.parse("{\"a\":1} trailing"));
        assertThrows(IllegalArgumentException.class, () -> Json.parse(""));
    }
}
