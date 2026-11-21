package dev.audismp.aegishider.platform;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

class PlatformClientSecurityTest {

    @Test
    void rejectsPlainHttpForRemoteHosts(@TempDir Path directory) throws Exception {
        InstallationIdentity identity = InstallationIdentity.loadOrCreate(directory);
        assertThrows(IllegalArgumentException.class,
                () -> new PlatformClient("http://platform.example.com", "aegishider", 5, identity));
    }

    @Test
    void allowsLocalDevelopmentOverHttp(@TempDir Path directory) throws Exception {
        InstallationIdentity identity = InstallationIdentity.loadOrCreate(directory);
        assertDoesNotThrow(() -> new PlatformClient("http://localhost:8787", "aegishider", 5, identity));
        assertDoesNotThrow(() -> new PlatformClient("https://platform.example.com", "aegishider", 5, identity));
    }

    @Test
    void jsonParserRejectsDeepNesting() {
        String deep = "[".repeat(64) + "0" + "]".repeat(64);
        assertThrows(IllegalArgumentException.class, () -> Json.parse(deep));
    }
}
