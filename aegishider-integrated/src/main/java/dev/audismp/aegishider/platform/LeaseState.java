package dev.audismp.aegishider.platform;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.GeneralSecurityException;
import java.security.PublicKey;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Persists the last verified signed lease (with its public keys) so a restart during a
 * platform outage can keep protection inside the signed-off offline grace window.
 * The lease itself is Ed25519-signed; this file cannot mint a new one.
 */
final class LeaseState {

    record Stored(LeaseVerifier.Lease lease, long serverTime, long graceSeconds, long highWatermark) {
    }

    private LeaseState() {
    }

    static void save(Path file, String encodedLease, String keyId, long expiresAt, long serverTime,
                     long graceHours, long highWatermark, InstallationIdentity identity, String product,
                     Map<String, PublicKey> keys) throws IOException {
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("version", 1);
        root.put("installation_uuid", identity.installationUuid());
        root.put("product", product);
        root.put("lease", encodedLease);
        root.put("key_id", keyId);
        root.put("expires_at", expiresAt);
        root.put("server_time", serverTime);
        root.put("offline_grace_hours", graceHours);
        root.put("high_watermark", highWatermark);
        List<Object> keyList = new ArrayList<>(keys.size());
        for (Map.Entry<String, PublicKey> entry : keys.entrySet()) {
            Map<String, Object> key = new LinkedHashMap<>();
            key.put("key_id", entry.getKey());
            key.put("public_key", Base64.getEncoder().encodeToString(entry.getValue().getEncoded()));
            keyList.add(key);
        }
        root.put("keys", keyList);

        Files.createDirectories(file.getParent());
        Path temporary = file.resolveSibling(file.getFileName() + ".tmp");
        Files.write(temporary, Json.stringify(root).getBytes(StandardCharsets.UTF_8));
        try {
            Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException exception) {
            Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    static Stored load(Path file, InstallationIdentity identity, String product, String extraFingerprint,
                       long nowSeconds, long clockSkewSeconds) throws IOException, GeneralSecurityException {
        if (!Files.isRegularFile(file)) {
            return null;
        }
        Map<String, Object> root = Json.asObject(
                Json.parse(Files.readString(file, StandardCharsets.UTF_8)));
        if (Json.longValue(root, "version", 0) != 1) {
            return null;
        }
        String installationUuid = Json.string(root, "installation_uuid");
        String storedProduct = Json.string(root, "product");
        if (!identity.installationUuid().equals(installationUuid) || !product.equals(storedProduct)) {
            return null;
        }
        String encodedLease = Json.string(root, "lease");
        String keyId = Json.string(root, "key_id");
        if (encodedLease == null || encodedLease.isBlank() || keyId == null || keyId.isBlank()) {
            return null;
        }
        long highWatermark = Json.longValue(root, "high_watermark", 0);
        if (highWatermark > 0 && nowSeconds < highWatermark - clockSkewSeconds) {
            // A rolled-back clock must not extend an expired lease.
            throw new GeneralSecurityException("system clock is behind the last verified server time");
        }

        Map<String, PublicKey> keys = new LinkedHashMap<>(
                LeaseVerifier.parseKeys(Json.asArray(root.get("keys"))));
        keys.entrySet().removeIf(entry ->
                !PlatformTrust.isTrusted(entry.getKey(), entry.getValue(), extraFingerprint));
        if (keys.isEmpty()) {
            return null;
        }
        long graceHours = Math.max(0, Math.min(Json.longValue(root, "offline_grace_hours", 72), 168));
        long graceSeconds = graceHours * 3600L;
        LeaseVerifier.Lease lease = LeaseVerifier.verify(encodedLease, keys,
                identity.installationUuid(), product, nowSeconds, clockSkewSeconds, graceSeconds);
        long serverTime = Json.longValue(root, "server_time", 0);
        return new Stored(lease, serverTime, graceSeconds, highWatermark);
    }
}
