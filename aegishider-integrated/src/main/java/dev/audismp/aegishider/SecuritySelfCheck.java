package dev.audismp.aegishider;

import java.lang.management.ManagementFactory;
import java.util.Locale;

/** Cheap runtime debugger/agent detection used by the protected startup gate. */
public final class SecuritySelfCheck {

    private SecuritySelfCheck() {
    }

    public static boolean debuggerOrAgentDetected() {
        try {
            for (String raw : ManagementFactory.getRuntimeMXBean().getInputArguments()) {
                if (raw == null) {
                    continue;
                }
                String arg = raw.toLowerCase(Locale.ROOT);
                if (arg.contains("jdwp")
                        || arg.startsWith("-xdebug")
                        || arg.startsWith("-xrunjdwp")
                        || arg.startsWith("-agentlib:")
                        || arg.startsWith("-agentpath:")
                        || arg.startsWith("-javaagent:")
                        || arg.contains("jmxremote")
                        // Runtime attach lets an agent load after startup; it is how most
                        // instrumentation-based bypasses inject without relaunching.
                        || arg.contains("-xx:+startattachlistener")) {
                    return true;
                }
            }
        } catch (Throwable ignored) {
            // ManagementFactory is unavailable on an exotic JVM: do not block startup.
        }
        return false;
    }
}
