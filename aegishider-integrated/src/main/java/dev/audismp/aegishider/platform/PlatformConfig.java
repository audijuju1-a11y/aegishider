package dev.audismp.aegishider.platform;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Flat, dependency-free reader for platform.yml with secure defaults and clamping. */
public final class PlatformConfig {

    public enum Enforcement {
        WARN,
        ENFORCE
    }

    private final boolean enabled;
    private final String apiBaseUrl;
    private final String product;
    private final String serverName;
    private final String expectedJarSha256;
    private final String trustedKeySha256;
    private final Enforcement enforcement;
    private final int trialDays;
    private final int heartbeatMinutes;
    private final int leaseRefreshMinutes;
    private final int requestTimeoutSeconds;
    private final boolean telemetryEnabled;
    private final int maxBuffer;
    private final int batchMax;
    private final int flushSeconds;

    private PlatformConfig(boolean enabled, String apiBaseUrl, String product, String serverName,
                           String expectedJarSha256, String trustedKeySha256, Enforcement enforcement,
                           int trialDays, int heartbeatMinutes, int leaseRefreshMinutes,
                           int requestTimeoutSeconds, boolean telemetryEnabled, int maxBuffer,
                           int batchMax, int flushSeconds) {
        this.enabled = enabled;
        this.apiBaseUrl = apiBaseUrl;
        this.product = product;
        this.serverName = serverName;
        this.expectedJarSha256 = expectedJarSha256;
        this.trustedKeySha256 = trustedKeySha256;
        this.enforcement = enforcement;
        this.trialDays = trialDays;
        this.heartbeatMinutes = heartbeatMinutes;
        this.leaseRefreshMinutes = leaseRefreshMinutes;
        this.requestTimeoutSeconds = requestTimeoutSeconds;
        this.telemetryEnabled = telemetryEnabled;
        this.maxBuffer = maxBuffer;
        this.batchMax = batchMax;
        this.flushSeconds = flushSeconds;
    }

    public static PlatformConfig defaults() {
        return new PlatformConfig(true, "", "aegishider", "", "", "", Enforcement.ENFORCE, 7, 3, 60, 15,
                true, 500, 50, 60);
    }

    public static PlatformConfig load(Path file) throws IOException {
        if (!Files.isRegularFile(file)) {
            return defaults();
        }
        return fromMap(parseYaml(Files.readAllLines(file, StandardCharsets.UTF_8)));
    }

    public static PlatformConfig fromMap(Map<String, String> values) {
        PlatformConfig defaults = defaults();
        String url = value(values, "api-base-url", defaults.apiBaseUrl).trim();
        while (url.endsWith("/")) {
            url = url.substring(0, url.length() - 1);
        }
        // Direct comparison, not valueOf: ProGuard may rename enum constants, and the
        // reflective valueOf("ENFORCE") would then silently fall back to WARN.
        // Fail closed: only an explicit "warn" opts out of enforcement. A missing,
        // blank or misspelled value keeps the licence gate on instead of silently
        // disabling it.
        String rawEnforcement = value(values, "enforcement", "enforce").trim();
        Enforcement enforcement = "warn".equalsIgnoreCase(rawEnforcement)
                ? Enforcement.WARN : Enforcement.ENFORCE;
        return new PlatformConfig(
                bool(values, "enabled", defaults.enabled),
                url,
                nonBlank(value(values, "product", defaults.product), defaults.product),
                value(values, "server-name", defaults.serverName).trim(),
                value(values, "integrity.jar-sha256", defaults.expectedJarSha256).trim().toLowerCase(Locale.ROOT),
                value(values, "trusted-key-sha256", defaults.trustedKeySha256).trim().toLowerCase(Locale.ROOT),
                enforcement,
                clamp(intValue(values, "trial-days", defaults.trialDays), 0, 365),
                clamp(intValue(values, "heartbeat-minutes", defaults.heartbeatMinutes), 1, 60),
                clamp(intValue(values, "lease-refresh-minutes", defaults.leaseRefreshMinutes), 1, 1440),
                clamp(intValue(values, "request-timeout-seconds", defaults.requestTimeoutSeconds), 3, 60),
                bool(values, "telemetry.enabled", defaults.telemetryEnabled),
                clamp(intValue(values, "telemetry.max-buffer", defaults.maxBuffer), 50, 5000),
                clamp(intValue(values, "telemetry.batch-max", defaults.batchMax), 1, 50),
                clamp(intValue(values, "telemetry.flush-seconds", defaults.flushSeconds), 10, 600));
    }

    static Map<String, String> parseYaml(List<String> lines) {
        Map<String, String> values = new LinkedHashMap<>();
        Map<Integer, String> sections = new LinkedHashMap<>();
        for (String raw : lines) {
            if (raw == null || raw.isBlank() || raw.trim().startsWith("#")) {
                continue;
            }
            int indent = 0;
            while (indent < raw.length() && raw.charAt(indent) == ' ') {
                indent++;
            }
            String content = stripComment(raw.trim());
            int colon = content.indexOf(':');
            if (colon <= 0) {
                continue;
            }
            String key = content.substring(0, colon).trim();
            String value = content.substring(colon + 1).trim();
            final int currentIndent = indent;
            sections.keySet().removeIf(level -> level >= currentIndent);
            StringBuilder prefix = new StringBuilder();
            sections.entrySet().stream()
                    .sorted(Map.Entry.comparingByKey())
                    .forEach(entry -> prefix.append(entry.getValue()).append('.'));
            if (value.isEmpty()) {
                sections.put(indent, key);
            } else {
                values.put(prefix + key, unquote(value));
            }
        }
        return values;
    }

    private static String stripComment(String content) {
        boolean quoted = false;
        for (int i = 0; i < content.length(); i++) {
            char c = content.charAt(i);
            if (c == '"') {
                quoted = !quoted;
            }
            if (c == '#' && !quoted && (i == 0 || Character.isWhitespace(content.charAt(i - 1)))) {
                return content.substring(0, i).trim();
            }
        }
        return content;
    }

    private static String unquote(String value) {
        if (value.length() >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
            return value.substring(1, value.length() - 1);
        }
        return value;
    }

    private static String value(Map<String, String> values, String key, String fallback) {
        return values.getOrDefault(key, fallback);
    }

    private static String nonBlank(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }

    private static boolean bool(Map<String, String> values, String key, boolean fallback) {
        String value = values.get(key);
        if (value == null) {
            return fallback;
        }
        return switch (value.trim().toLowerCase(Locale.ROOT)) {
            case "true", "yes", "on", "1" -> true;
            case "false", "no", "off", "0" -> false;
            default -> fallback;
        };
    }

    private static int intValue(Map<String, String> values, String key, int fallback) {
        String value = values.get(key);
        if (value == null) {
            return fallback;
        }
        try {
            return Integer.parseInt(value.trim());
        } catch (NumberFormatException exception) {
            return fallback;
        }
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    public boolean enabled() {
        return enabled;
    }

    public String apiBaseUrl() {
        return apiBaseUrl;
    }

    public String product() {
        return product;
    }

    public String serverName() {
        return serverName;
    }

    public String expectedJarSha256() {
        return expectedJarSha256;
    }

    public String trustedKeySha256() {
        return trustedKeySha256;
    }

    public Enforcement enforcement() {
        return enforcement;
    }

    public int trialDays() {
        return trialDays;
    }

    public int heartbeatMinutes() {
        return heartbeatMinutes;
    }

    public int leaseRefreshMinutes() {
        return leaseRefreshMinutes;
    }

    public int requestTimeoutSeconds() {
        return requestTimeoutSeconds;
    }

    public boolean telemetryEnabled() {
        return telemetryEnabled;
    }

    public int maxBuffer() {
        return maxBuffer;
    }

    public int batchMax() {
        return batchMax;
    }

    public int flushSeconds() {
        return flushSeconds;
    }

    public boolean usable() {
        if (!enabled || apiBaseUrl.isBlank()) {
            return false;
        }
        if (apiBaseUrl.startsWith("https://")) {
            return true;
        }
        if (!apiBaseUrl.startsWith("http://")) {
            return false;
        }
        try {
            String host = java.net.URI.create(apiBaseUrl).getHost();
            return host != null && ("localhost".equalsIgnoreCase(host)
                    || "127.0.0.1".equals(host) || "::1".equals(host));
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }
}
