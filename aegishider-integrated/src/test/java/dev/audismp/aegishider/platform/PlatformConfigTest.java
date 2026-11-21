package dev.audismp.aegishider.platform;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PlatformConfigTest {

    @Test
    void parsesNestedYamlAndTrailingSlash() {
        Map<String, String> values = PlatformConfig.parseYaml(List.of(
                "enabled: true",
                "api-base-url: https://platform.example.com/",
                "product: aegishider",
                "telemetry:",
                "  enabled: false",
                "  max-buffer: 99999",
                "  batch-max: 0",
                "heartbeat-minutes: 0"));
        PlatformConfig config = PlatformConfig.fromMap(values);
        assertTrue(config.enabled());
        assertEquals("https://platform.example.com", config.apiBaseUrl());
        assertFalse(config.telemetryEnabled());
        assertEquals(5000, config.maxBuffer());
        assertEquals(1, config.batchMax());
        assertEquals(1, config.heartbeatMinutes());
        assertTrue(config.usable());
    }

    @Test
    void usesSecureDefaultsAndClampsValues() {
        PlatformConfig defaults = PlatformConfig.defaults();
        assertTrue(defaults.enabled());
        assertFalse(defaults.usable());
        assertEquals(PlatformConfig.Enforcement.ENFORCE, defaults.enforcement());

        PlatformConfig clamped = PlatformConfig.fromMap(Map.of(
                "heartbeat-minutes", "999",
                "lease-refresh-minutes", "0",
                "request-timeout-seconds", "1",
                "trial-days", "-5",
                "enforcement", "ENFORCE"));
        assertEquals(60, clamped.heartbeatMinutes());
        assertEquals(1, clamped.leaseRefreshMinutes());
        assertEquals(3, clamped.requestTimeoutSeconds());
        assertEquals(0, clamped.trialDays());
        assertEquals(PlatformConfig.Enforcement.ENFORCE, clamped.enforcement());
    }

    @Test
    void invalidEnforcementFailsClosedToEnforce() {
        PlatformConfig config = PlatformConfig.fromMap(Map.of("enforcement", "explode"));
        assertEquals(PlatformConfig.Enforcement.ENFORCE, config.enforcement());
        PlatformConfig warn = PlatformConfig.fromMap(Map.of("enforcement", "warn"));
        assertEquals(PlatformConfig.Enforcement.WARN, warn.enforcement());
    }

    @Test
    void serverNameAndIntegrityPinAreParsed() {
        PlatformConfig config = PlatformConfig.fromMap(Map.of(
                "server-name", "Siam SMP",
                "integrity.jar-sha256", "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789"));
        assertEquals("Siam SMP", config.serverName());
        assertEquals("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
                config.expectedJarSha256());
        assertTrue(PlatformConfig.defaults().serverName().isEmpty());
        assertTrue(PlatformConfig.defaults().expectedJarSha256().isEmpty());
    }
}
