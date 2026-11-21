package dev.audismp.aegishider.maintenance;

import dev.audismp.aegishider.AegishiderPlugin;
import dev.audismp.aegishider.core.BoundedTaskExecutor;
import org.bukkit.scheduler.BukkitTask;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.concurrent.atomic.AtomicLong;
import java.util.logging.Level;

/**
 * Periodic operational snapshot writer. This is the concrete non-security workload of the
 * bounded async pool: the JSON string is captured on the main thread from immutable counters
 * and then written to disk off-thread. It never touches world/entity/player state off-thread
 * and security decisions never depend on it.
 *
 * <p>Output: {@code plugins/Aegishider/diagnostics.json} (atomic replace).
 */
public final class DiagnosticsExporter {

    private final AegishiderPlugin plugin;
    private final Path outputFile;
    private final AtomicLong snapshotsWritten = new AtomicLong();
    private final AtomicLong writeFailures = new AtomicLong();
    private final AtomicLong lastWriteMs = new AtomicLong();
    private BukkitTask task;

    public DiagnosticsExporter(AegishiderPlugin plugin, Path dataFolder) {
        this.plugin = plugin;
        this.outputFile = dataFolder.resolve("diagnostics.json");
    }

    public void start() {
        stop();
        // First snapshot after 1 minute, then every 2 minutes. Cheap (small JSON, bounded
        // pool, one file replace).
        task = plugin.getServer().getScheduler().runTaskTimer(plugin, this::collectAndSubmit,
                20L * 60L, 20L * 120L);
    }

    public void stop() {
        if (task != null) {
            task.cancel();
            task = null;
        }
    }

    /** Main thread: captures the snapshot and hands the JSON write to the async pool. */
    public void collectAndSubmit() {
        BoundedTaskExecutor pool = plugin.asyncPool();
        if (pool == null) {
            return;
        }
        final String json;
        try {
            json = DiagnosticsSnapshot.capture(plugin).toJson();
        } catch (RuntimeException ex) {
            writeFailures.incrementAndGet();
            plugin.getLogger().log(Level.WARNING, "Diagnostics snapshot capture failed", ex);
            return;
        }
        boolean accepted = pool.submit(() -> {
            try {
                writeAtomically(outputFile, json);
                snapshotsWritten.incrementAndGet();
                lastWriteMs.set(System.currentTimeMillis());
            } catch (IOException ex) {
                writeFailures.incrementAndGet();
                plugin.getLogger().log(Level.WARNING, "Diagnostics snapshot write failed", ex);
            }
        });
        if (!accepted) {
            writeFailures.incrementAndGet();
        }
    }

    static void writeAtomically(Path outputFile, String json) throws IOException {
        Path parent = outputFile.getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }
        Path temporary = outputFile.resolveSibling(outputFile.getFileName() + ".tmp");
        Files.writeString(temporary, json, StandardCharsets.UTF_8);
        try {
            Files.move(temporary, outputFile, StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE);
        } catch (java.nio.file.AtomicMoveNotSupportedException ex) {
            Files.move(temporary, outputFile, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    public long snapshotsWritten() {
        return snapshotsWritten.get();
    }

    public long writeFailures() {
        return writeFailures.get();
    }

    public long lastWriteMs() {
        return lastWriteMs.get();
    }

    public Path outputFile() {
        return outputFile;
    }

    public String diagnostics() {
        long last = lastWriteMs.get();
        return "snapshots=" + snapshotsWritten.get()
                + " failures=" + writeFailures.get()
                + " lastWrite=" + (last == 0 ? "never" : (System.currentTimeMillis() - last) + "ms ago")
                + " file=" + outputFile.getFileName();
    }
}
