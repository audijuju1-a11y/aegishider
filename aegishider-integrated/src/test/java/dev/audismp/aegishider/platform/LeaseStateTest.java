package dev.audismp.aegishider.platform;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class LeaseStateTest {

    @TempDir
    Path directory;

    private String lease(KeyPair signer, long issuedAt, long expiresAt, String installationUuid,
                         String product) throws Exception {
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("v", 1);
        claims.put("jti", "lease_cached");
        claims.put("license_id", "lic_cached");
        claims.put("product", product);
        claims.put("installation_uuid", installationUuid);
        claims.put("issued_at", issuedAt);
        claims.put("expires_at", expiresAt);
        claims.put("key_id", "test-key-1");
        byte[] payload = Json.stringify(claims).getBytes(StandardCharsets.UTF_8);
        Signature signature = Signature.getInstance("Ed25519");
        signature.initSign(signer.getPrivate());
        signature.update(payload);
        return CanonicalRequest.base64Url(payload) + "." + CanonicalRequest.base64Url(signature.sign());
    }

    @Test
    void loadsAValidCachedLeaseAndRejectsAClockRollback() throws Exception {
        InstallationIdentity identity = InstallationIdentity.loadOrCreate(directory.resolve("platform"));
        KeyPair keyPair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
        String fingerprint = PlatformTrust.sha256(keyPair.getPublic().getEncoded());
        long now = CanonicalRequest.nowSeconds();
        String encoded = lease(keyPair, now, now + 3600, identity.installationUuid(), "aegishider");
        Map<String, java.security.PublicKey> keys = Map.of("test-key-1", keyPair.getPublic());

        LeaseState.save(directory.resolve("lease-state.json"), encoded, "test-key-1",
                now + 3600, now, 72, now, identity, "aegishider", keys);

        LeaseState.Stored stored = LeaseState.load(directory.resolve("lease-state.json"), identity,
                "aegishider", fingerprint, now, 300);
        assertNotNull(stored);
        assertEquals("lic_cached", stored.lease().claims().get("license_id"));
        assertEquals(72 * 3600L, stored.graceSeconds());

        assertThrows(GeneralSecurityException.class, () -> LeaseState.load(
                directory.resolve("lease-state.json"), identity, "aegishider", fingerprint,
                now - 3600, 300));
    }

    @Test
    void acceptsAnExpiredCachedLeaseOnlyInsideGrace() throws Exception {
        InstallationIdentity identity = InstallationIdentity.loadOrCreate(directory.resolve("platform"));
        KeyPair keyPair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
        String fingerprint = PlatformTrust.sha256(keyPair.getPublic().getEncoded());
        long now = CanonicalRequest.nowSeconds();
        String encoded = lease(keyPair, now - 7200, now - 3600, identity.installationUuid(), "aegishider");
        Map<String, java.security.PublicKey> keys = Map.of("test-key-1", keyPair.getPublic());
        Path file = directory.resolve("lease-state.json");

        LeaseState.save(file, encoded, "test-key-1", now - 3600, now - 7200, 3, now, identity,
                "aegishider", keys);
        assertNotNull(LeaseState.load(file, identity, "aegishider", fingerprint, now, 300));

        LeaseState.save(file, encoded, "test-key-1", now - 3600, now - 7200, 0, now, identity,
                "aegishider", keys);
        assertThrows(IllegalArgumentException.class, () -> LeaseState.load(
                file, identity, "aegishider", fingerprint, now, 300));
    }

    @Test
    void ignoresLeasesForAnotherInstallation() throws Exception {
        InstallationIdentity identity = InstallationIdentity.loadOrCreate(directory.resolve("platform"));
        InstallationIdentity other = InstallationIdentity.loadOrCreate(directory.resolve("other"));
        KeyPair keyPair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
        String fingerprint = PlatformTrust.sha256(keyPair.getPublic().getEncoded());
        long now = CanonicalRequest.nowSeconds();
        String encoded = lease(keyPair, now, now + 3600, other.installationUuid(), "aegishider");
        Map<String, java.security.PublicKey> keys = Map.of("test-key-1", keyPair.getPublic());
        Path file = directory.resolve("lease-state.json");
        LeaseState.save(file, encoded, "test-key-1", now + 3600, now, 72, now, other,
                "aegishider", keys);

        assertNull(LeaseState.load(file, identity, "aegishider", fingerprint, now, 300));
    }
}
