package dev.audismp.aegishider.platform;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.Signature;
import java.util.Base64;
import java.util.UUID;

/** Builds the exact request signature defined by the Aegishider platform protocol. */
public final class CanonicalRequest {

    private CanonicalRequest() {
    }

    public static String canonical(String method, String path, String installationUuid,
                                   long timestampSeconds, String nonce, byte[] body) {
        return String.join("\n",
                method.toUpperCase(),
                path,
                installationUuid,
                Long.toString(timestampSeconds),
                nonce,
                sha256Hex(body));
    }

    public static String sha256Hex(byte[] data) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(data == null ? new byte[0] : data);
            StringBuilder builder = new StringBuilder(hash.length * 2);
            for (byte value : hash) {
                builder.append(Character.forDigit((value >> 4) & 0xF, 16));
                builder.append(Character.forDigit(value & 0xF, 16));
            }
            return builder.toString();
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("SHA-256 unavailable", exception);
        }
    }

    public static String nonce() {
        byte[] bytes = new byte[32];
        java.security.SecureRandom random = new java.security.SecureRandom();
        random.nextBytes(bytes);
        return base64Url(bytes);
    }

    public static String sign(PrivateKey privateKey, String canonical) throws GeneralSecurityException {
        Signature signature = Signature.getInstance("Ed25519");
        signature.initSign(privateKey);
        signature.update(canonical.getBytes(StandardCharsets.UTF_8));
        return Base64.getEncoder().encodeToString(signature.sign());
    }

    public static boolean verify(java.security.PublicKey publicKey, byte[] message, byte[] signatureBytes)
            throws GeneralSecurityException {
        Signature signature = Signature.getInstance("Ed25519");
        signature.initVerify(publicKey);
        signature.update(message);
        return signature.verify(signatureBytes);
    }

    public static String base64Url(byte[] bytes) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    public static byte[] decodeBase64Url(String value) {
        String normalized = value.replace('-', '+').replace('_', '/');
        int padding = (4 - (normalized.length() % 4)) % 4;
        return Base64.getDecoder().decode(normalized + "=".repeat(padding));
    }

    public static String newInstallationUuid() {
        return UUID.randomUUID().toString();
    }

    public static long nowSeconds() {
        return System.currentTimeMillis() / 1000L;
    }
}
