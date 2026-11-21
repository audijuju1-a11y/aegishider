package dev.audismp.aegishider.platform;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermission;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class InstallationIdentityTest {

    @TempDir
    Path directory;

    @Test
    void createsAndReloadsAStableIdentity() throws Exception {
        InstallationIdentity first = InstallationIdentity.loadOrCreate(directory);
        InstallationIdentity second = InstallationIdentity.loadOrCreate(directory);

        assertEquals(first.installationUuid(), second.installationUuid());
        assertEquals(first.publicKeyBase64(), second.publicKeyBase64());
        assertEquals(first.fingerprint(), second.fingerprint());
        assertTrue(first.fingerprint().matches("[0-9a-f]{64}"));
        assertTrue(Files.isRegularFile(directory.resolve("identity.json")));
        assertTrue(Files.isRegularFile(directory.resolve("private.key")));
    }

    @Test
    void signsVerifiableData() throws Exception {
        InstallationIdentity identity = InstallationIdentity.loadOrCreate(directory);
        String canonical = "POST\n/api/v1/installations/lease\nuuid\n1\nnonce\nhash";
        java.security.Signature verifier = java.security.Signature.getInstance("Ed25519");
        verifier.initVerify(java.security.KeyFactory.getInstance("Ed25519").generatePublic(
                new java.security.spec.X509EncodedKeySpec(
                        java.util.Base64.getDecoder().decode(identity.publicKeyBase64()))));
        verifier.update(canonical.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        assertTrue(verifier.verify(identity.sign(canonical)));
        assertNotNull(identity.privateKey());
    }

    @Test
    void restrictsKeyAndDirectoryPermissionsOnPosix() throws Exception {
        assumeTrue(FileSystems.getDefault().supportedFileAttributeViews().contains("posix"),
                "requires a POSIX filesystem (Linux)");
        InstallationIdentity.loadOrCreate(directory);
        Set<PosixFilePermission> keyPermissions = Files.getPosixFilePermissions(directory.resolve("private.key"));
        assertEquals(Set.of(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE), keyPermissions);
        Set<PosixFilePermission> directoryPermissions = Files.getPosixFilePermissions(directory);
        assertEquals(Set.of(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE,
                PosixFilePermission.OWNER_EXECUTE), directoryPermissions);
    }
}
