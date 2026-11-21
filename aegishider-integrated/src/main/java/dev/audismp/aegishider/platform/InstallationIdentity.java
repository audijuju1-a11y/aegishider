package dev.audismp.aegishider.platform;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.PosixFilePermission;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * Per-server Ed25519 identity. Files live under plugins/Aegishider/platform/:
 * identity.json (uuid, public key, fingerprint) and private.key (PKCS#8 base64).
 * The private key is written atomically and, where supported, restricted to the owner.
 */
public final class InstallationIdentity {

    private final String installationUuid;
    private final KeyPair keyPair;
    private final String publicKeyBase64;
    private final String fingerprint;
    private final long createdAt;

    private InstallationIdentity(String installationUuid, KeyPair keyPair, String publicKeyBase64,
                                 String fingerprint, long createdAt) {
        this.installationUuid = installationUuid;
        this.keyPair = keyPair;
        this.publicKeyBase64 = publicKeyBase64;
        this.fingerprint = fingerprint;
        this.createdAt = createdAt;
    }

    public static InstallationIdentity loadOrCreate(Path directory) throws IOException, GeneralSecurityException {
        Files.createDirectories(directory);
        restrictDirectory(directory);
        Path identityFile = directory.resolve("identity.json");
        Path keyFile = directory.resolve("private.key");
        if (Files.isRegularFile(identityFile) && Files.isRegularFile(keyFile)) {
            String json = Files.readString(identityFile, StandardCharsets.UTF_8);
            Map<String, Object> data = Json.asObject(Json.parse(json));
            String uuid = Json.string(data, "installation_uuid");
            String publicKey = Json.string(data, "public_key");
            String storedFingerprint = Json.string(data, "fingerprint_sha256");
            long created = Json.longValue(data, "created_at", System.currentTimeMillis() / 1000L);
            byte[] encodedPrivate = Files.readAllBytes(keyFile);
            byte[] decoded = null;
            try {
                decoded = Base64.getDecoder().decode(new String(encodedPrivate, StandardCharsets.US_ASCII).trim());
                KeyFactory factory = KeyFactory.getInstance("Ed25519");
                PrivateKey privateKey = factory.generatePrivate(new PKCS8EncodedKeySpec(decoded));
                PublicKey publicKeyObject = factory.generatePublic(
                        new X509EncodedKeySpec(Base64.getDecoder().decode(publicKey)));
                String computed = fingerprint(publicKeyObject);
                if (!computed.equalsIgnoreCase(storedFingerprint)) {
                    throw new GeneralSecurityException("identity fingerprint does not match the stored public key");
                }
                restrictPrivateFile(keyFile);
                return new InstallationIdentity(uuid, new KeyPair(publicKeyObject, privateKey),
                        publicKey, computed, created);
            } finally {
                java.util.Arrays.fill(encodedPrivate, (byte) 0);
                if (decoded != null) {
                    java.util.Arrays.fill(decoded, (byte) 0);
                }
            }
        }
        return create(directory, identityFile, keyFile);
    }

    private static InstallationIdentity create(Path directory, Path identityFile, Path keyFile)
            throws IOException, GeneralSecurityException {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("Ed25519");
        KeyPair keyPair = generator.generateKeyPair();
        String uuid = CanonicalRequest.newInstallationUuid();
        String publicKeyBase64 = Base64.getEncoder().encodeToString(keyPair.getPublic().getEncoded());
        String fingerprint = fingerprint(keyPair.getPublic());
        long created = System.currentTimeMillis() / 1000L;

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("installation_uuid", uuid);
        data.put("public_key", publicKeyBase64);
        data.put("fingerprint_sha256", fingerprint);
        data.put("created_at", created);
        writeAtomically(identityFile, Json.stringify(data).getBytes(StandardCharsets.UTF_8), false);
        writeAtomically(keyFile,
                Base64.getEncoder().encodeToString(keyPair.getPrivate().getEncoded())
                        .getBytes(StandardCharsets.UTF_8), true);

        return new InstallationIdentity(uuid, keyPair, publicKeyBase64, fingerprint, created);
    }

    private static void writeAtomically(Path target, byte[] content, boolean privateFile) throws IOException {
        Path temporary = target.resolveSibling(target.getFileName() + ".tmp");
        if (privateFile) {
            restrictNewPrivateFile(temporary);
        }
        Files.write(temporary, content);
        try {
            Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException exception) {
            Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING);
        }
        if (privateFile) {
            restrictPrivateFile(target);
        }
    }

    private static void restrictDirectory(Path directory) {
        try {
            Files.setPosixFilePermissions(directory, Set.of(
                    PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE,
                    PosixFilePermission.OWNER_EXECUTE));
        } catch (UnsupportedOperationException | IOException ignored) {
            // Windows/NTFS: inherit the server directory ACLs.
        }
    }

    private static void restrictPrivateFile(Path file) {
        try {
            Files.setPosixFilePermissions(file, Set.of(
                    PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE));
        } catch (UnsupportedOperationException | IOException ignored) {
            // Windows/NTFS: inherit the directory ACLs.
        }
    }

    /** Creates the temp file with 0600 before the key material is written. */
    private static void restrictNewPrivateFile(Path temporary) {
        try {
            Files.deleteIfExists(temporary);
            Files.createFile(temporary, java.nio.file.attribute.PosixFilePermissions.asFileAttribute(Set.of(
                    PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE)));
        } catch (UnsupportedOperationException | IOException ignored) {
            // Non-POSIX or leftover file: the post-write chmod is the fallback.
        }
    }

    public static String fingerprint(PublicKey publicKey) throws GeneralSecurityException {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest(publicKey.getEncoded());
        StringBuilder builder = new StringBuilder(hash.length * 2);
        for (byte value : hash) {
            builder.append(Character.forDigit((value >> 4) & 0xF, 16));
            builder.append(Character.forDigit(value & 0xF, 16));
        }
        return builder.toString();
    }

    public String installationUuid() {
        return installationUuid;
    }

    public String publicKeyBase64() {
        return publicKeyBase64;
    }

    public String fingerprint() {
        return fingerprint;
    }

    public long createdAt() {
        return createdAt;
    }

    public byte[] sign(String canonical) throws GeneralSecurityException {
        java.security.Signature signature = java.security.Signature.getInstance("Ed25519");
        signature.initSign(keyPair.getPrivate());
        signature.update(canonical.getBytes(StandardCharsets.UTF_8));
        return signature.sign();
    }

    public PrivateKey privateKey() {
        return keyPair.getPrivate();
    }
}
