package dev.audismp.aegishider.platform;

import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * Self-integrity check inspired by Sentinel Shield's signed-release model: the
 * platform.yml pin identifies the exact jar the owner deployed. A mismatch is
 * reported as telemetry and shown in /aegishider license status; it never
 * disables the packet-level security core (fail-closed hiding stays active).
 */
public final class IntegrityGuard {

    public record Result(String status, String actualSha256, String expectedSha256, String location) {
    }

    private IntegrityGuard() {
    }

    public static Result verify(String expectedSha256) {
        String expected = normalizePin(expectedSha256);
        try {
            URL source = IntegrityGuard.class.getProtectionDomain().getCodeSource() == null
                    ? null
                    : IntegrityGuard.class.getProtectionDomain().getCodeSource().getLocation();
            if (source == null) {
                return new Result("UNKNOWN", null, expected, null);
            }
            Path path = Paths.get(source.toURI());
            if (!Files.isRegularFile(path)) {
                return new Result("UNPACKED", null, expected, path.toString());
            }
            String actual = sha256(path);
            return new Result(statusFor(actual, expected), actual, expected, path.toString());
        } catch (Exception exception) {
            return new Result("ERROR", null, expected, null);
        }
    }

    /** A malformed pin must not turn every start into a false TAMPERED alarm. */
    static String normalizePin(String pin) {
        if (pin == null) {
            return "";
        }
        String normalized = pin.trim().toLowerCase(java.util.Locale.ROOT);
        return normalized.matches("[0-9a-f]{64}") ? normalized : "";
    }

    static String statusFor(String actual, String expected) {
        if (expected == null || expected.isEmpty()) {
            return "UNPINNED";
        }
        return actual != null && actual.equalsIgnoreCase(expected) ? "VERIFIED" : "TAMPERED";
    }

    static String sha256(Path file) throws IOException, NoSuchAlgorithmException {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[64 * 1024];
        try (InputStream input = Files.newInputStream(file)) {
            int read;
            while ((read = input.read(buffer)) > 0) {
                digest.update(buffer, 0, read);
            }
        }
        byte[] hash = digest.digest();
        StringBuilder builder = new StringBuilder(hash.length * 2);
        for (byte value : hash) {
            builder.append(Character.forDigit((value >> 4) & 0xF, 16));
            builder.append(Character.forDigit(value & 0xF, 16));
        }
        return builder.toString();
    }
}
