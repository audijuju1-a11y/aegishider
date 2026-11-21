package dev.audismp.aegishider.platform;

import dev.audismp.aegishider.AegishiderPlugin;
import dev.audismp.aegishider.metrics.Metrics;
import dev.audismp.aegishider.packet.PacketGateway;
import org.bukkit.Bukkit;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.scheduler.BukkitTask;

import java.lang.management.GarbageCollectorMXBean;
import java.lang.management.ManagementFactory;
import java.lang.management.OperatingSystemMXBean;
import java.lang.management.RuntimeMXBean;
import java.lang.management.ThreadMXBean;
import java.nio.file.FileStore;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Main-thread sampler for deep server health. Bukkit world/player APIs are only touched on
 * the main thread; the heartbeat reads the published immutable snapshot from its async
 * executor. Only aggregate server data is collected — no player names, UUIDs, IPs, chat,
 * coordinates or inventories.
 */
public final class ServerHealthSampler {

    private static final int MAX_WORLDS = 32;
    private static final int MAX_ENTITIES_REPORTED = 10_000_000;

    private final AegishiderPlugin plugin;
    private volatile Map<String, Object> snapshot = Map.of();
    private BukkitTask task;

    public ServerHealthSampler(AegishiderPlugin plugin) {
        this.plugin = plugin;
    }

    public void start() {
        if (task != null) {
            return;
        }
        try {
            task = Bukkit.getScheduler().runTaskTimer(plugin, this::sample, 100L, 600L);
        } catch (Throwable throwable) {
            plugin.getLogger().log(java.util.logging.Level.FINE,
                    "Server health sampler could not start: " + throwable.getMessage(), throwable);
        }
    }

    public void stop() {
        if (task != null) {
            task.cancel();
            task = null;
        }
    }

    /** Immutable snapshot; safe to read from the platform executor. */
    public Map<String, Object> snapshot() {
        return snapshot;
    }

    private void sample() {
        try {
            Map<String, Object> server = new LinkedHashMap<>();
            Map<String, Object> aegishider = new LinkedHashMap<>();
            collectServer(server);
            collectAegishider(aegishider);
            Map<String, Object> root = new LinkedHashMap<>();
            root.put("server", Collections.unmodifiableMap(server));
            root.put("aegishider", Collections.unmodifiableMap(aegishider));
            snapshot = Collections.unmodifiableMap(root);
        } catch (Throwable throwable) {
            plugin.getLogger().log(java.util.logging.Level.FINE,
                    "Server health sampling failed: " + throwable.getMessage(), throwable);
        }
    }

    private void collectServer(Map<String, Object> server) {
        double[] tps = Bukkit.getTPS();
        server.put("tps_1m", round(clamp(tps.length > 0 ? tps[0] : 20.0, 0.0, 100.0), 3));
        server.put("tps_5m", round(clamp(tps.length > 1 ? tps[1] : 20.0, 0.0, 100.0), 3));
        server.put("tps_15m", round(clamp(tps.length > 2 ? tps[2] : 20.0, 0.0, 100.0), 3));
        server.put("mspt_avg", round(clamp(Bukkit.getAverageTickTime(), 0.0, 10_000.0), 2));

        List<Player> online = new ArrayList<>(Bukkit.getOnlinePlayers());
        server.put("players_online", online.size());
        server.put("max_players", Bukkit.getMaxPlayers());
        long pingSum = 0;
        int pingCount = 0;
        for (Player player : online) {
            try {
                pingSum += Math.max(0, player.getPing());
                pingCount++;
            } catch (RuntimeException ignored) {
                // Player disconnected during the sample.
            }
        }
        server.put("avg_ping_ms", pingCount == 0 ? 0 : round(pingSum / (double) pingCount, 1));

        List<World> worlds = Bukkit.getWorlds();
        List<Map<String, Object>> worldRows = new ArrayList<>(Math.min(MAX_WORLDS, worlds.size()));
        int chunkTotal = 0;
        int entityTotal = 0;
        for (World world : worlds) {
            if (worldRows.size() >= MAX_WORLDS) {
                break;
            }
            int chunks = 0;
            int entities = 0;
            try {
                chunks = Math.min(MAX_ENTITIES_REPORTED, world.getLoadedChunks().length);
                entities = Math.min(MAX_ENTITIES_REPORTED, world.getEntities().size());
            } catch (RuntimeException ignored) {
                // A world can unload while the sampler runs.
            }
            chunkTotal = clampInt(chunkTotal + chunks, 0, MAX_ENTITIES_REPORTED);
            entityTotal = clampInt(entityTotal + entities, 0, MAX_ENTITIES_REPORTED);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("name", truncate(world.getName(), 64));
            row.put("environment", truncate(world.getEnvironment().name(), 32));
            row.put("players", Math.min(100_000, world.getPlayers().size()));
            row.put("chunks", chunks);
            row.put("entities", entities);
            worldRows.add(Collections.unmodifiableMap(row));
        }
        server.put("world_count", worlds.size());
        server.put("chunk_count", chunkTotal);
        server.put("entity_count", entityTotal);
        server.put("worlds", Collections.unmodifiableList(worldRows));

        Runtime runtime = Runtime.getRuntime();
        long total = runtime.totalMemory();
        long free = runtime.freeMemory();
        long max = runtime.maxMemory();
        server.put("heap_used_mb", mb(Math.max(0, total - free)));
        server.put("heap_committed_mb", mb(total));
        server.put("heap_max_mb", mb(max));

        collectCpu(server);
        collectGc(server);
        collectThreads(server);
        collectUptime(server);
        collectDisk(server);

        server.put("server_version", truncate(Bukkit.getVersion(), 160));
        server.put("java_version", truncate(String.valueOf(System.getProperty("java.version", "?")), 80));
        server.put("java_vendor", truncate(String.valueOf(System.getProperty("java.vendor", "?")), 80));
        server.put("os_name", truncate(String.valueOf(System.getProperty("os.name", "?")), 80));
        server.put("os_arch", truncate(String.valueOf(System.getProperty("os.arch", "?")), 40));
        server.put("plugin_count", Math.min(1000, Bukkit.getPluginManager().getPlugins().length));
        putPacketEventsVersion(server);
    }

    private void collectCpu(Map<String, Object> server) {
        try {
            OperatingSystemMXBean os = ManagementFactory.getOperatingSystemMXBean();
            server.put("available_processors", Math.max(1, os.getAvailableProcessors()));
            double load = os.getSystemLoadAverage();
            if (Double.isFinite(load) && load >= 0) {
                server.put("system_load_average", round(Math.min(10_000.0, load), 2));
            }
            try {
                Class<?> extended = Class.forName("com.sun.management.OperatingSystemMXBean");
                Object value = extended.getMethod("getProcessCpuLoad").invoke(os);
                if (value instanceof Number number) {
                    double percent = number.doubleValue() * 100.0;
                    if (Double.isFinite(percent) && percent >= 0) {
                        server.put("process_cpu_load", round(Math.min(100.0, percent), 2));
                    }
                }
                Object system = extended.getMethod("getCpuLoad").invoke(os);
                if (system instanceof Number number) {
                    double percent = number.doubleValue() * 100.0;
                    if (Double.isFinite(percent) && percent >= 0) {
                        server.put("system_cpu_load", round(Math.min(100.0, percent), 2));
                    }
                }
            } catch (ReflectiveOperationException ignored) {
                // Standard OperatingSystemMXBean on this JVM: load average is enough.
            }
        } catch (RuntimeException ignored) {
            // CPU counters are optional.
        }
    }

    private void collectGc(Map<String, Object> server) {
        try {
            long count = 0;
            long time = 0;
            for (GarbageCollectorMXBean bean : ManagementFactory.getGarbageCollectorMXBeans()) {
                count += Math.max(0, bean.getCollectionCount());
                time += Math.max(0, bean.getCollectionTime());
            }
            server.put("gc_count", Math.min(1_000_000_000L, count));
            server.put("gc_time_ms", Math.min(1_000_000_000_000L, time));
        } catch (RuntimeException ignored) {
            // Optional.
        }
    }

    private void collectThreads(Map<String, Object> server) {
        try {
            ThreadMXBean threads = ManagementFactory.getThreadMXBean();
            server.put("threads_live", Math.min(100_000, threads.getThreadCount()));
            server.put("threads_peak", Math.min(100_000, Math.max(threads.getThreadCount(), threads.getPeakThreadCount())));
            server.put("threads_daemon", Math.min(100_000, threads.getDaemonThreadCount()));
        } catch (RuntimeException ignored) {
            // Optional.
        }
    }

    private void collectUptime(Map<String, Object> server) {
        try {
            RuntimeMXBean runtime = ManagementFactory.getRuntimeMXBean();
            server.put("uptime_seconds", Math.min(1_000_000_000_000L, runtime.getUptime() / 1000L));
        } catch (RuntimeException ignored) {
            // Optional.
        }
    }

    private void collectDisk(Map<String, Object> server) {
        try {
            FileStore store = Files.getFileStore(plugin.getDataFolder().toPath());
            server.put("disk_usable_mb", Math.min(Long.MAX_VALUE / (1024L * 1024L), store.getUsableSpace() / (1024L * 1024L)));
            server.put("disk_total_mb", Math.min(Long.MAX_VALUE / (1024L * 1024L), store.getTotalSpace() / (1024L * 1024L)));
        } catch (Throwable ignored) {
            // Data folder may not exist yet or the filesystem may not expose it.
        }
    }

    private void putPacketEventsVersion(Map<String, Object> server) {
        try {
            Class<?> apiClass = Class.forName("com.github.retrooper.packetevents.PacketEvents");
            Object api = apiClass.getMethod("getAPI").invoke(null);
            Object version = api.getClass().getMethod("getVersion").invoke(api);
            if (version != null) {
                server.put("packet_events_version", truncate(version.toString(), 40));
            }
        } catch (Throwable ignored) {
            // PacketEvents may be absent; the top-level status already reports that.
        }
    }

    private void collectAegishider(Map<String, Object> aegishider) {
        Metrics metrics = plugin.metrics();
        PacketGateway gateway = plugin.packetGateway();
        PlatformService platform = plugin.platformService();
        aegishider.put("protection", plugin.protectionStarted()
                ? "ACTIVE" : (plugin.licenseGated() ? "WAITING_FOR_LICENSE" : "INACTIVE"));
        aegishider.put("license_gated", plugin.licenseGated());
        aegishider.put("gateway_state", gateway == null ? "MISSING" : gateway.state().name());
        aegishider.put("gateway_detail", truncate(gateway == null ? "not initialized" : gateway.statusLine(), 160));
        aegishider.put("block_protection", plugin.blockProtectionActive());
        aegishider.put("item_protection", plugin.config().anyItemProtectionEnabled());
        aegishider.put("tracked_entities", Math.min(100_000_000, metrics.trackedItemCount()));
        aegishider.put("revealed_pairs", Math.min(100_000_000, metrics.revealedItemViewerPairs()));
        aegishider.put("protected_blocks", Math.min(100_000_000, metrics.hiddenBlockCount()));
        aegishider.put("sensitive_chunks", Math.min(100_000_000, metrics.sensitiveChunkCount()));
        aegishider.put("online_sessions", Math.min(100_000, metrics.onlineSessions()));
        aegishider.put("plugin_tick_p50_us", metrics.tickPercentileNanos(0.50) / 1000L);
        aegishider.put("plugin_tick_p95_us", metrics.tickPercentileNanos(0.95) / 1000L);
        aegishider.put("plugin_tick_p99_us", metrics.tickPercentileNanos(0.99) / 1000L);
        aegishider.put("tick_overruns", Math.min(1_000_000_000L, metrics.tickOverruns()));
        aegishider.put("raycasts", Math.min(1_000_000_000_000L, metrics.raycasts()));
        aegishider.put("ray_deferred", Math.min(1_000_000_000_000L, metrics.raycastBudgetDeferred()));
        aegishider.put("async_queue", Math.min(100_000, metrics.asyncQueueSize()));
        aegishider.put("async_queue_capacity", Math.min(100_000, metrics.asyncQueueCapacity()));
        aegishider.put("async_threads", Math.min(1000, metrics.asyncThreads()));
        aegishider.put("async_rejections", Math.min(1_000_000_000L, metrics.asyncRejections()));
        aegishider.put("internal_errors", Math.min(1_000_000_000L, metrics.internalErrors()));
        aegishider.put("config_warnings", Math.min(1_000_000_000L, metrics.configWarnings()));
        aegishider.put("config_revision", Math.max(0, plugin.config().revision()));
        aegishider.put("license_state", platform == null ? "DISABLED" : platform.state());
        aegishider.put("lease_source", platform == null ? "none" : platform.leaseSource());
        aegishider.put("lease_expires_at", platform == null ? 0 : platform.leaseExpiresAt());
    }

    private static double clamp(double value, double min, double max) {
        if (!Double.isFinite(value)) {
            return min;
        }
        return Math.max(min, Math.min(max, value));
    }

    private static int clampInt(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    private static double round(double value, int decimals) {
        double factor = Math.pow(10, decimals);
        return Math.round(value * factor) / factor;
    }

    private static long mb(long bytes) {
        return Math.max(0, bytes) / (1024L * 1024L);
    }

    private static String truncate(String value, int max) {
        if (value == null) {
            return "";
        }
        return value.length() <= max ? value : value.substring(0, max);
    }
}
