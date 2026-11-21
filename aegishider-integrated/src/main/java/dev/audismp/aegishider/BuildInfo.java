package dev.audismp.aegishider;

import java.io.InputStream;
import java.util.Properties;

/** Build stamp generated per Maven profile, so "per-version" artifacts are verifiable. */
public final class BuildInfo {

    private static final String TARGET = load("target");
    private static final String PAPER_API = load("paper");

    private BuildInfo() {
    }

    public static String target() {
        return TARGET;
    }

    public static String paperApi() {
        return PAPER_API;
    }

    private static String load(String key) {
        try (InputStream input = BuildInfo.class.getResourceAsStream("/build.properties")) {
            if (input == null) {
                return "unknown";
            }
            Properties properties = new Properties();
            properties.load(input);
            String value = properties.getProperty(key);
            return value == null || value.isBlank() ? "unknown" : value.trim();
        } catch (Exception exception) {
            return "unknown";
        }
    }
}
