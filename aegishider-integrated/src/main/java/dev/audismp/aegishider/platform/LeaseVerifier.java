package dev.audismp.aegishider.platform;

import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Verifies a signed lease and its claims without trusting the transport. */
public final class LeaseVerifier {

    public record Lease(String payloadJson, Map<String, Object> claims, byte[] payloadBytes,
                        long expiresAt, String keyId) {
    }

    private LeaseVerifier() {
    }

    public static Lease verify(String lease, Map<String, PublicKey> keys, String installationUuid,
                               String product, long nowSeconds, long clockSkewSeconds)
            throws GeneralSecurityException {
        return verify(lease, keys, installationUuid, product, nowSeconds, clockSkewSeconds, 0);
    }

    /**
     * Verifies a lease, optionally accepting an expired one while it is still inside the
     * signed-off offline grace window. Used only for a locally cached lease after a
     * restart; a live refresh never accepts an expired lease.
     */
    public static Lease verify(String lease, Map<String, PublicKey> keys, String installationUuid,
                               String product, long nowSeconds, long clockSkewSeconds,
                               long offlineGraceSeconds)
            throws GeneralSecurityException {
        if (lease == null || lease.isBlank()) {
            throw new IllegalArgumentException("empty lease");
        }
        int separator = lease.indexOf('.');
        if (separator <= 0 || separator == lease.length() - 1) {
            throw new IllegalArgumentException("lease must be payload.signature");
        }
        byte[] payloadBytes = CanonicalRequest.decodeBase64Url(lease.substring(0, separator));
        byte[] signatureBytes = CanonicalRequest.decodeBase64Url(lease.substring(separator + 1));
        Map<String, Object> claims = Json.asObject(Json.parse(new String(payloadBytes, java.nio.charset.StandardCharsets.UTF_8)));

        String keyId = Json.string(claims, "key_id");
        PublicKey publicKey = keys.get(keyId);
        if (publicKey == null) {
            throw new IllegalArgumentException("lease uses an unknown signing key: " + keyId);
        }
        if (!CanonicalRequest.verify(publicKey, payloadBytes, signatureBytes)) {
            throw new GeneralSecurityException("lease signature is invalid");
        }

        long version = Json.longValue(claims, "v", 0);
        if (version != 1) {
            throw new IllegalArgumentException("unsupported lease version " + version);
        }
        String leaseInstallation = Json.string(claims, "installation_uuid");
        if (!installationUuid.equals(leaseInstallation)) {
            throw new IllegalArgumentException("lease belongs to a different installation");
        }
        String leaseProduct = Json.string(claims, "product");
        if (!product.equals(leaseProduct)) {
            throw new IllegalArgumentException("lease is for a different product");
        }
        long issuedAt = Json.longValue(claims, "issued_at", 0);
        long expiresAt = Json.longValue(claims, "expires_at", 0);
        if (issuedAt <= 0 || expiresAt <= 0) {
            throw new IllegalArgumentException("lease is missing issued_at/expires_at");
        }
        if (expiresAt <= issuedAt) {
            throw new IllegalArgumentException("lease expiry is not after its issue time");
        }
        long graceSeconds = Math.max(0, offlineGraceSeconds);
        if (expiresAt + graceSeconds <= nowSeconds) {
            throw new IllegalArgumentException("lease has expired");
        }
        if (issuedAt > nowSeconds + clockSkewSeconds) {
            throw new IllegalArgumentException("lease was issued in the future");
        }
        return new Lease(new String(payloadBytes, java.nio.charset.StandardCharsets.UTF_8),
                claims, payloadBytes, expiresAt, keyId);
    }

    public static PublicKey decodePublicKey(String base64Spki) throws GeneralSecurityException {
        byte[] der = Base64.getDecoder().decode(base64Spki);
        return KeyFactory.getInstance("Ed25519").generatePublic(new X509EncodedKeySpec(der));
    }

    public static Map<String, PublicKey> parseKeys(List<Object> keyObjects) throws GeneralSecurityException {
        Map<String, PublicKey> keys = new LinkedHashMap<>();
        for (Object item : keyObjects) {
            Map<String, Object> object = Json.asObject(item);
            String keyId = Json.string(object, "key_id");
            String publicKey = Json.string(object, "public_key");
            if (keyId == null || publicKey == null) {
                continue;
            }
            keys.put(keyId, decodePublicKey(publicKey));
        }
        return keys;
    }

    public static Map<String, Object> claimsFrom(String payloadJson) {
        return Json.asObject(Json.parse(payloadJson));
    }
}
