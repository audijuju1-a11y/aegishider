package dev.audismp.aegishider.maintenance;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DiagnosticsExporterTest {

    private static DiagnosticsSnapshot snapshot() {
        return new DiagnosticsSnapshot(1234L, "3.1.0", "Paper \"test\"\\version", 2, 2, 5, 1,
                7, 3, 10, 1, 90, 20, 300, 20, 50, 120, 4, 30, 2, 12, 1, 40, 60,
                0, 0, 4, 50, 1, 3, 2, 1, 2, 0, 1, 0, 0, 0);
    }

    @Test
    void jsonEscapesStringsAndContainsMetricFields() {
        String json = snapshot().toJson();
        assertTrue(json.startsWith("{"));
        assertTrue(json.endsWith("}"));
        assertTrue(json.contains("\"pluginVersion\":\"3.1.0\""));
        assertTrue(json.contains("\"serverVersion\":\"Paper \\\"test\\\"\\\\version\""));
        assertTrue(json.contains("\"tickP99Us\":120"));
        assertTrue(json.contains("\"detectedOverflow\":0"));
        assertTrue(json.contains("\"chunkFailClosed\":1"));
        assertEquals(38, json.split(":", -1).length - 1, "one key per snapshot field");
    }

    @Test
    void escapeHandlesControlCharactersAndNull() {
        assertEquals("a\\\"b\\\\c\\nd\\re\\tf", DiagnosticsSnapshot.escape("a\"b\\c\nd\re\tf"));
        assertEquals("\\u0001", DiagnosticsSnapshot.escape("\u0001"));
        StringBuilder builder = new StringBuilder();
        DiagnosticsSnapshot.appendString(builder, "k", null, false);
        assertEquals("\"k\":null", builder.toString());
    }

    @Test
    void writeAtomicallyCreatesAndReplacesTheFileWithoutTempLeftovers(@TempDir Path tempDir)
            throws Exception {
        Path target = tempDir.resolve("nested").resolve("diagnostics.json");
        DiagnosticsExporter.writeAtomically(target, "{\"a\":1}");
        assertEquals("{\"a\":1}", Files.readString(target, StandardCharsets.UTF_8));
        DiagnosticsExporter.writeAtomically(target, "{\"a\":2}");
        assertEquals("{\"a\":2}", Files.readString(target, StandardCharsets.UTF_8));
        assertFalse(Files.exists(target.resolveSibling("diagnostics.json.tmp")));
    }
}
