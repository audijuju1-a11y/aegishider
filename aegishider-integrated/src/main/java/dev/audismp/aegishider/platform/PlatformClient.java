package dev.audismp.aegishider.platform;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.PublicKey;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Blocking HTTP client for the platform API. All calls are made from the plugin's
 * dedicated platform executor, never from the Minecraft main thread.
 */
public final class PlatformClient {

    public record Registration(String installationId, String activationCode,
                               long activationExpiresAt, String portalUrl, boolean reused) {
    }

    public record LeaseResponse(String lease, String keyId, long expiresAt, long serverTime,
                                long offlineGraceHours, Map<String, PublicKey> keys) {
    }

    public static final class PlatformApiException extends IOException {
        private final int status;
        private final long retryAfterSeconds;

        public PlatformApiException(int status, String message, long retryAfterSeconds) {
            super(message);
            this.status = status;
            this.retryAfterSeconds = retryAfterSeconds;
        }

        public int status() {
            return status;
        }

        public long retryAfterSeconds() {
            return retryAfterSeconds;
        }
    }

    private final String baseUrl;
    private final String product;
    private final InstallationIdentity identity;
    private final HttpClient httpClient;
    private final Duration requestTimeout;

    public PlatformClient(String baseUrl, String product, int timeoutSeconds, InstallationIdentity identity) {
        String normalized = baseUrl;
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        requireSecureBaseUrl(normalized);
        this.baseUrl = normalized;
        this.product = product;
        this.identity = identity;
        this.requestTimeout = Duration.ofSeconds(timeoutSeconds);
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(timeoutSeconds))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
    }

    private static void requireSecureBaseUrl(String baseUrl) {
        URI uri;
        try {
            uri = URI.create(baseUrl);
        } catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException("api-base-url is not a valid URL", exception);
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(java.util.Locale.ROOT);
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(java.util.Locale.ROOT);
        boolean local = host.equals("localhost") || host.equals("127.0.0.1") || host.equals("::1");
        if (!scheme.equals("https") && !(scheme.equals("http") && local)) {
            throw new IllegalArgumentException("api-base-url must use https (http is allowed only for localhost)");
        }
    }

    public Registration register(String pluginVersion, String minecraftVersion,
                                 String platform, String serverName, String javaVersion) throws IOException {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("product", product);
        body.put("installation_uuid", identity.installationUuid());
        body.put("public_key", identity.publicKeyBase64());
        body.put("fingerprint_sha256", identity.fingerprint());
        body.put("plugin_version", pluginVersion);
        body.put("minecraft_version", minecraftVersion);
        body.put("platform", platform);
        body.put("server_name", serverName);
        body.put("java_version", javaVersion);

        // Registration is signed even on first use: the platform requires proof of possession
        // before it re-issues a pairing code for an existing installation, and signing is
        // harmless when the installation is new.
        HttpResponse<String> response = signedPost("/api/v1/installations/register",
                Json.stringify(body));
        requireSuccess(response);
        Map<String, Object> data = data(response.body());
        return new Registration(
                Json.string(data, "installation_id"),
                Json.string(data, "activation_code"),
                Json.longValue(data, "activation_expires_at", 0),
                Json.string(data, "portal_url"),
                Boolean.TRUE.equals(data.get("reused")));
    }

    public LeaseResponse requestLease(String pluginVersion) throws IOException {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("plugin_version", pluginVersion);
        HttpResponse<String> response = signedPost("/api/v1/installations/lease", Json.stringify(body));
        requireSuccess(response);
        Map<String, Object> data = data(response.body());
        String lease = Json.string(data, "lease");
        String keyId = Json.string(data, "key_id");
        long expiresAt = Json.longValue(data, "expires_at", 0);
        long serverTime = Json.longValue(data, "server_time", 0);
        long grace = Json.longValue(data, "offline_grace_hours", 72);
        Map<String, PublicKey> keys;
        try {
            Object rawKeys = data.get("keys");
            keys = LeaseVerifier.parseKeys(Json.asArray(rawKeys));
        } catch (GeneralSecurityException exception) {
            throw new IOException("platform returned invalid signing keys", exception);
        }
        return new LeaseResponse(lease, keyId, expiresAt, serverTime, grace, keys);
    }

    public void heartbeat(Map<String, Object> payload) throws IOException {
        HttpResponse<String> response = signedPost("/api/v1/installations/heartbeat", Json.stringify(payload));
        requireSuccess(response);
    }

    public void events(List<Map<String, Object>> events) throws IOException {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("events", events);
        HttpResponse<String> response = signedPost("/api/v1/installations/events", Json.stringify(body));
        requireSuccess(response);
    }

    private HttpResponse<String> signedPost(String path, String jsonBody) throws IOException {
        String nonce = CanonicalRequest.nonce();
        long timestamp = CanonicalRequest.nowSeconds();
        String canonical = CanonicalRequest.canonical("POST", path, identity.installationUuid(),
                timestamp, nonce, jsonBody.getBytes(StandardCharsets.UTF_8));
        String signature;
        try {
            signature = CanonicalRequest.sign(identity.privateKey(), canonical);
        } catch (GeneralSecurityException exception) {
            throw new IOException("cannot sign platform request", exception);
        }
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + path))
                .timeout(requestTimeout)
                .header("Content-Type", "application/json")
                .header("User-Agent", "Aegishider-PlatformClient/1")
                .header("X-AG-Installation", identity.installationUuid())
                .header("X-AG-Timestamp", Long.toString(timestamp))
                .header("X-AG-Nonce", nonce)
                .header("X-AG-Signature", signature)
                .POST(HttpRequest.BodyPublishers.ofString(jsonBody, StandardCharsets.UTF_8))
                .build();
        return send(request);
    }

    private HttpResponse<String> send(HttpRequest request) throws IOException {
        try {
            HttpResponse<String> response = httpClient.send(request,
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            String body = response.body();
            if (body != null && body.length() > 512_000) {
                throw new IOException("platform response too large (" + body.length() + " chars)");
            }
            return response;
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IOException("platform request interrupted", exception);
        }
    }

    private static void requireSuccess(HttpResponse<String> response) throws PlatformApiException {
        int status = response.statusCode();
        if (status >= 200 && status < 300) {
            return;
        }
        String body = response.body() == null ? "" : response.body();
        if (body.length() > 300) {
            body = body.substring(0, 300);
        }
        long retryAfter = 0;
        String header = response.headers().firstValue("Retry-After").orElse("");
        if (!header.isBlank()) {
            try {
                retryAfter = Math.max(0, Long.parseLong(header.trim()));
            } catch (NumberFormatException ignored) {
                // HTTP-date form is not used by the platform; ignore it.
            }
        }
        throw new PlatformApiException(status, "platform returned HTTP " + status + ": " + body, retryAfter);
    }

    private static Map<String, Object> data(String body) throws IOException {
        try {
            Map<String, Object> root = Json.asObject(Json.parse(body));
            return Json.asObject(root.get("data"));
        } catch (RuntimeException exception) {
            throw new IOException("platform returned an invalid JSON response", exception);
        }
    }
}
