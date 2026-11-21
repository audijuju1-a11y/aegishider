package dev.audismp.aegishider.platform;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

class CanonicalRequestTest {

    @Test
    void buildsTheDocumentedCanonicalString() {
        String canonical = CanonicalRequest.canonical(
                "POST",
                "/api/v1/installations/lease",
                "3f1c2a90-0000-4000-8000-000000000000",
                1794000000L,
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                new byte[0]);
        assertEquals("""
                POST
                /api/v1/installations/lease
                3f1c2a90-0000-4000-8000-000000000000
                1794000000
                AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
                e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855""", canonical);
    }

    @Test
    void bodyHashCoversExactBytes() {
        byte[] body = "{\"plugin_version\":\"3.3.0\"}".getBytes(StandardCharsets.UTF_8);
        String first = CanonicalRequest.sha256Hex(body);
        String second = CanonicalRequest.sha256Hex(body);
        assertEquals(first, second);
        assertEquals(64, first.length());
        assertNotEquals(first, CanonicalRequest.sha256Hex("{}".getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    void base64UrlRoundTripWithoutPadding() {
        byte[] bytes = new byte[]{0, 1, 2, (byte) 0xFF, (byte) 0xFE};
        String encoded = CanonicalRequest.base64Url(bytes);
        assertEquals(-1, encoded.indexOf('='));
        org.junit.jupiter.api.Assertions.assertArrayEquals(bytes, CanonicalRequest.decodeBase64Url(encoded));
    }
}
