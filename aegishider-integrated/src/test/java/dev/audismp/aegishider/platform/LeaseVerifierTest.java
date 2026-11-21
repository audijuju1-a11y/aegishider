package dev.audismp.aegishider.platform;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PublicKey;
import java.security.Signature;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class LeaseVerifierTest {

    private KeyPair keyPair;
    private Map<String, PublicKey> keys;
    private String installationUuid;

    @BeforeEach
    void setUp() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("Ed25519");
        keyPair = generator.generateKeyPair();
        keys = new LinkedHashMap<>();
        keys.put("test-key-1", keyPair.getPublic());
        installationUuid = "3f1c2a90-0000-4000-8000-000000000000";
    }

    private String lease(long issuedAt, long expiresAt, String installation, String product, String keyId)
            throws GeneralSecurityException {
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("v", 1);
        claims.put("jti", "lease_test");
        claims.put("license_id", "lic_test");
        claims.put("product", product);
        claims.put("installation_uuid", installation);
        claims.put("issued_at", issuedAt);
        claims.put("expires_at", expiresAt);
        claims.put("key_id", keyId);
        byte[] payload = Json.stringify(claims).getBytes(StandardCharsets.UTF_8);
        Signature signer = Signature.getInstance("Ed25519");
        signer.initSign(keyPair.getPrivate());
        signer.update(payload);
        return CanonicalRequest.base64Url(payload) + "." + CanonicalRequest.base64Url(signer.sign());
    }

    @Test
    void verifiesAValidLease() throws Exception {
        long now = CanonicalRequest.nowSeconds();
        LeaseVerifier.Lease lease = LeaseVerifier.verify(
                lease(now, now + 3600, installationUuid, "aegishider", "test-key-1"),
                keys, installationUuid, "aegishider", now, 300);
        assertEquals("lic_test", lease.claims().get("license_id"));
        assertEquals("test-key-1", lease.keyId());
        assertTrue(lease.expiresAt() > now);
    }

    @Test
    void rejectsExpiredLease() throws Exception {
        long now = CanonicalRequest.nowSeconds();
        String value = lease(now - 7200, now - 3600, installationUuid, "aegishider", "test-key-1");
        assertThrows(IllegalArgumentException.class, () -> LeaseVerifier.verify(
                value, keys, installationUuid, "aegishider", now, 300));
    }

    @Test
    void acceptsAnExpiredLeaseOnlyInsideTheOfflineGrace() throws Exception {
        long now = CanonicalRequest.nowSeconds();
        String value = lease(now - 7200, now - 1800, installationUuid, "aegishider", "test-key-1");
        LeaseVerifier.Lease cached = LeaseVerifier.verify(
                value, keys, installationUuid, "aegishider", now, 300, 3600);
        assertEquals("lic_test", cached.claims().get("license_id"));
        assertThrows(IllegalArgumentException.class, () -> LeaseVerifier.verify(
                value, keys, installationUuid, "aegishider", now, 300));
        assertThrows(IllegalArgumentException.class, () -> LeaseVerifier.verify(
                value, keys, installationUuid, "aegishider", now + 2000, 300, 3600));
    }

    @Test
    void rejectsWrongInstallationProductAndKey() throws Exception {
        long now = CanonicalRequest.nowSeconds();
        String value = lease(now, now + 3600, installationUuid, "aegishider", "test-key-1");
        assertThrows(IllegalArgumentException.class, () -> LeaseVerifier.verify(
                value, keys, "another-installation", "aegishider", now, 300));
        assertThrows(IllegalArgumentException.class, () -> LeaseVerifier.verify(
                value, keys, installationUuid, "another-product", now, 300));
        assertThrows(IllegalArgumentException.class, () -> LeaseVerifier.verify(
                value, Map.of(), installationUuid, "aegishider", now, 300));
    }

    @Test
    void rejectsTamperedPayloadAndSignature() throws Exception {
        long now = CanonicalRequest.nowSeconds();
        String value = lease(now, now + 3600, installationUuid, "aegishider", "test-key-1");
        String[] parts = value.split("\\.");
        byte[] payload = CanonicalRequest.decodeBase64Url(parts[0]);
        byte[] tamperedPayload = new String(payload, StandardCharsets.UTF_8)
                .replace("lic_test", "lic_tesX")
                .getBytes(StandardCharsets.UTF_8);
        String tampered = CanonicalRequest.base64Url(tamperedPayload) + "." + parts[1];
        assertThrows(GeneralSecurityException.class, () -> LeaseVerifier.verify(
                tampered, keys, installationUuid, "aegishider", now, 300));

        byte[] signature = CanonicalRequest.decodeBase64Url(parts[1]);
        signature[0] ^= 0x01;
        String badSignature = parts[0] + "." + CanonicalRequest.base64Url(signature);
        assertThrows(GeneralSecurityException.class, () -> LeaseVerifier.verify(
                badSignature, keys, installationUuid, "aegishider", now, 300));
    }

    @Test
    void rejectsLeasesWithoutSaneIssueAndExpiry() throws Exception {
        long now = CanonicalRequest.nowSeconds();
        assertThrows(IllegalArgumentException.class, () -> LeaseVerifier.verify(
                lease(0, now + 3600, installationUuid, "aegishider", "test-key-1"),
                keys, installationUuid, "aegishider", now, 300));
        assertThrows(IllegalArgumentException.class, () -> LeaseVerifier.verify(
                lease(now + 100, now + 50, installationUuid, "aegishider", "test-key-1"),
                keys, installationUuid, "aegishider", now, 300));
    }

    @Test
    void decodesPublishedKeys() throws Exception {
        String spki = Base64.getEncoder().encodeToString(keyPair.getPublic().getEncoded());
        PublicKey decoded = LeaseVerifier.decodePublicKey(spki);
        assertEquals(Base64.getEncoder().encodeToString(keyPair.getPublic().getEncoded()),
                Base64.getEncoder().encodeToString(decoded.getEncoded()));
    }
}
