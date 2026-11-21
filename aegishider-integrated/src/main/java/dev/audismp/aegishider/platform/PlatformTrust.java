package dev.audismp.aegishider.platform;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.PublicKey;
import java.util.Base64;
import java.util.HexFormat;

/**
 * Trust anchors for platform leases. The transport's key list is attacker-controlled
 * (api-base-url is administrator configurable), so a bare key_id proves nothing. The
 * production Ed25519 key is pinned by the SHA-256 of its SPKI DER; extra fingerprints
 * can be added in platform.yml during a planned key rotation.
 */
public final class PlatformTrust {

    public static final String PRODUCTION_KEY_ID = "prod-1";
    // Encoded rather than a compile-time ConstantValue so the release string pass sees it
    // as an LDC instruction and encrypts it; a plain static final String would leak the
    // pin into the class constant pool.
    public static final String PRODUCTION_KEY_SHA256 = new String(
            Base64.getDecoder().decode(
                    "N2JhOTcyYWZmMGNlZmU2Y2YwYjU2OGUzMjBlODZkMDE0MGJkYzU1ZDY3ZDE4MzQ0NzkwMjBiMzVjZGY3NjFjZA=="),
            StandardCharsets.US_ASCII);

    private PlatformTrust() {
    }

    public static boolean isTrusted(String keyId, PublicKey key, String additionalFingerprint) {
        if (key == null) {
            return false;
        }
        String fingerprint = sha256(key.getEncoded());
        if (PRODUCTION_KEY_ID.equals(keyId) && PRODUCTION_KEY_SHA256.equals(fingerprint)) {
            return true;
        }
        return additionalFingerprint != null
                && !additionalFingerprint.isBlank()
                && additionalFingerprint.trim().equalsIgnoreCase(fingerprint);
    }

    static String sha256(byte[] value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 unavailable", exception);
        }
    }
}
