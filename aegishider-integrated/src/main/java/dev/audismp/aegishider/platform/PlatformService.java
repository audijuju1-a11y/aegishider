package dev.audismp.aegishider.platform;

import dev.audismp.aegishider.AegishiderPlugin;
import dev.audismp.aegishider.BuildInfo;
import org.bukkit.Bukkit;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Level;

/**
 * License and telemetry client lifecycle. All network I/O runs on a dedicated daemon
 * executor; the Minecraft main thread is only used for messages. Failures are logged and
 * surfaced through /aegishider license status and never disable the security core.
 */
public final class PlatformService {

    private final AegishiderPlugin plugin;
    private final Path directory;
    private final Deque<Map<String, Object>> eventBuffer = new ConcurrentLinkedDeque<>();
    private final AtomicInteger droppedEvents = new AtomicInteger();

    private volatile PlatformConfig config;
    private volatile InstallationIdentity identity;
    private volatile PlatformClient client;
    private volatile LeaseVerifier.Lease lease;
    private volatile long leaseExpiresAt;
    private volatile IntegrityGuard.Result integrity;
    private volatile String state = "DISABLED";
    private volatile String lastError;
    private volatile String activationCode;
    private volatile String portalUrl;
    private volatile long lastHeartbeatAt;
    private volatile long offlineGraceSeconds = 72 * 3600L;
    private volatile long serverTimeHighWatermark;
    private volatile String leaseSource = "none";
    private volatile boolean configError;
    private volatile boolean expiryNotified;
    private ScheduledExecutorService executor;

    public PlatformService(AegishiderPlugin plugin) {
        this.plugin = plugin;
        this.directory = plugin.getDataFolder().toPath().resolve("platform");
    }

    public void start() {
        try {
            configError = false;
            Path configFile = directory.resolve("platform.yml");
            if (!Files.isRegularFile(configFile)) {
                Files.createDirectories(directory);
                try (java.io.InputStream resource = plugin.getResource("platform.yml")) {
                    if (resource != null) {
                        Files.copy(resource, configFile);
                    }
                }
            }
            config = PlatformConfig.load(configFile);
            if (!config.enabled()) {
                state = "DISABLED";
                plugin.getLogger().info("Platform licensing is disabled in platform.yml.");
                return;
            }
            if (!config.usable()) {
                state = "UNCONFIGURED";
                plugin.getLogger().warning("Platform licensing is enabled but api-base-url is not set. "
                        + "Set it in plugins/Aegishider/platform/platform.yml, then run /aegishider license link.");
                return;
            }
            executor = Executors.newSingleThreadScheduledExecutor(runnable -> {
                Thread thread = new Thread(runnable, "Aegishider-Platform");
                thread.setDaemon(true);
                return thread;
            });
            state = "STARTING";
            executor.execute(this::initialize);
            executor.scheduleWithFixedDelay(this::refreshLease, 15, config.leaseRefreshMinutes() * 60L, TimeUnit.SECONDS);
            executor.scheduleWithFixedDelay(this::heartbeat, 30, config.heartbeatMinutes() * 60L, TimeUnit.SECONDS);
            if (config.telemetryEnabled()) {
                executor.scheduleWithFixedDelay(this::flushEvents, 20, config.flushSeconds(), TimeUnit.SECONDS);
            }
            executor.scheduleWithFixedDelay(this::enforceLease, 60, 300, TimeUnit.SECONDS);
        } catch (Throwable throwable) {
            // A broken platform config must not silently turn the licence gate off.
            configError = true;
            state = "ERROR";
            lastError = throwable.getMessage();
            plugin.getLogger().log(Level.WARNING, "Platform service failed to start: " + throwable.getMessage(), throwable);
        }
    }

    public void stop() {
        if (executor != null) {
            executor.shutdownNow();
            executor = null;
        }
    }

    private void initialize() {
        try {
            identity = InstallationIdentity.loadOrCreate(directory);
            client = new PlatformClient(config.apiBaseUrl(), config.product(),
                    config.requestTimeoutSeconds(), identity);
            state = "IDLE";
            checkIntegrity();
            plugin.getLogger().info("Platform identity ready: " + identity.installationUuid()
                    + " (fingerprint " + identity.fingerprint().substring(0, 12) + "...)");
            loadPersistedLease();
            refreshLease();
        } catch (Throwable throwable) {
            fail("cannot initialize platform identity", throwable);
        }
    }

    private void checkIntegrity() {
        String configuredPin = config.expectedJarSha256();
        if (!configuredPin.isBlank() && IntegrityGuard.normalizePin(configuredPin).isEmpty()) {
            plugin.getLogger().warning("integrity.jar-sha256 is not a 64-character hex SHA-256; "
                    + "the malformed pin is ignored (status stays UNPINNED).");
        }
        IntegrityGuard.Result result = IntegrityGuard.verify(configuredPin);
        integrity = result;
        if ("TAMPERED".equals(result.status())) {
            plugin.getLogger().warning("Plugin jar SHA-256 does not match integrity.jar-sha256 "
                    + "(actual " + result.actualSha256() + "). Reporting integrity.mismatch; "
                    + "the packet security core stays active.");
            recordEvent("integrity.mismatch", "warning", "plugin jar hash differs from the pinned release",
                    Map.of("actual_sha256", String.valueOf(result.actualSha256()),
                            "expected_sha256", String.valueOf(result.expectedSha256())));
        } else if ("VERIFIED".equals(result.status())) {
            plugin.getLogger().info("Plugin jar integrity verified: " + result.actualSha256());
        }
    }

    public void handle(CommandSender sender, String[] args) {
        String sub = args.length > 1 ? args[1].toLowerCase(java.util.Locale.ROOT) : "status";
        switch (sub) {
            case "link" -> link(sender);
            case "refresh" -> refresh(sender);
            case "verify" -> verify(sender);
            case "status" -> status(sender);
            default -> reply(sender, "§cUsage: /aegishider license <status|link|refresh|verify>");
        }
    }

    private void verify(CommandSender sender) {
        IntegrityGuard.Result result = integrity;
        if (result == null) {
            result = IntegrityGuard.verify(config == null ? "" : config.expectedJarSha256());
            integrity = result;
        }
        reply(sender, "§6§lPlugin jar integrity");
        reply(sender, "§7Status: §f" + result.status());
        reply(sender, "§7SHA-256: §f" + (result.actualSha256() == null ? "unavailable" : result.actualSha256()));
        if (result.expectedSha256() != null && !result.expectedSha256().isEmpty()) {
            reply(sender, "§7Pinned: §f" + result.expectedSha256());
        } else {
            reply(sender, "§7Pinned: §e(none)§7 - copy the SHA-256 above into "
                    + "platform.yml integrity.jar-sha256 to detect jar changes.");
        }
        if (result.location() != null) {
            reply(sender, "§7Source: §8" + result.location());
        }
    }

    private void link(CommandSender sender) {
        PlatformConfig current = config;
        if (current == null || !current.enabled()) {
            reply(sender, "§cPlatform licensing is disabled in platform.yml.");
            return;
        }
        if (!current.usable()) {
            reply(sender, "§cSet api-base-url in plugins/Aegishider/platform/platform.yml first.");
            return;
        }
        if (executor == null || executor.isShutdown()) {
            reply(sender, "§cPlatform service is not running. Restart the server after fixing platform.yml.");
            return;
        }
        reply(sender, "§7Contacting the platform…");
        executor.execute(() -> {
            try {
                ensureIdentity();
                PlatformClient.Registration registration = client().register(
                        plugin.getPluginMeta().getVersion(),
                        Bukkit.getMinecraftVersion(),
                        "Paper",
                        reportedServerName(current),
                        System.getProperty("java.version"));
                activationCode = registration.activationCode();
                portalUrl = registration.portalUrl();
                state = "PENDING_ACTIVATION";
                reply(sender, "§6§lAegishider license pairing");
                reply(sender, "§7Installation: §f" + identity.installationUuid());
                reply(sender, "§7Server name: §f" + reportedServerName(current));
                reply(sender, "§7Activation code: §e§l" + registration.activationCode());
                reply(sender, "§7Open: §b" + registration.portalUrl());
                reply(sender, "§7Enter the code in the portal, then run §f/aegishider license refresh§7.");
            } catch (PlatformClient.PlatformApiException exception) {
                if (exception.status() == 429) {
                    fail(sender, "registration is locked for "
                            + Math.max(1, exception.retryAfterSeconds() / 60) + " minute(s)", exception);
                } else {
                    fail(sender, "registration failed (HTTP " + exception.status() + ")", exception);
                }
            } catch (Throwable throwable) {
                fail(sender, "registration failed", throwable);
            }
        });
    }

    private String reportedServerName(PlatformConfig current) {
        if (current != null && !current.serverName().isBlank()) {
            return current.serverName().length() > 64 ? current.serverName().substring(0, 64) : current.serverName();
        }
        String derived = Bukkit.getServer().getName() + ":" + Bukkit.getServer().getPort();
        return derived.length() > 64 ? derived.substring(0, 64) : derived;
    }

    private void refresh(CommandSender sender) {
        if (executor == null || executor.isShutdown()) {
            status(sender);
            return;
        }
        reply(sender, "§7Refreshing license lease…");
        executor.execute(() -> {
            boolean ok = refreshLease();
            if (ok) {
                reply(sender, "§aLicense active. Lease expires " + Instant.ofEpochSecond(leaseExpiresAt) + ".");
            } else {
                reply(sender, "§cLicense refresh failed: " + (lastError == null ? "unknown error" : lastError));
            }
        });
    }

    private void status(CommandSender sender) {
        PlatformConfig current = config;
        reply(sender, "§6§lAegishider license");
        reply(sender, "§7State: §f" + state + "§7 (enforcement: §f"
                + (current == null ? "n/a" : current.enforcement().name().toLowerCase()) + "§7)");
        if (current != null) {
            reply(sender, "§7Platform: §f" + (current.apiBaseUrl().isBlank() ? "(not configured)" : current.apiBaseUrl()));
        }
        IntegrityGuard.Result checked = integrity;
        if (checked != null) {
            String color = switch (checked.status()) {
                case "VERIFIED" -> "§a";
                case "TAMPERED" -> "§c";
                default -> "§e";
            };
            reply(sender, "§7Jar integrity: " + color + checked.status() + "§7"
                    + (checked.actualSha256() == null ? "" : " §8" + checked.actualSha256().substring(0, 16) + "…"));
        }
        if (identity != null) {
            reply(sender, "§7Installation: §f" + identity.installationUuid());
            reply(sender, "§7Fingerprint: §f" + identity.fingerprint().substring(0, 20) + "…");
        }
        if (lease != null) {
            reply(sender, "§7License: §f" + lease.claims().get("license_id"));
            reply(sender, "§7Lease expires: §f" + Instant.ofEpochSecond(leaseExpiresAt)
                    + " §7(" + remainingMinutes() + " min)");
            reply(sender, "§7Lease source: §f" + leaseSource + "§7, offline grace: §f"
                    + (offlineGraceSeconds / 3600) + "h");
        } else if (activationCode != null) {
            reply(sender, "§7Activation code: §e§l" + activationCode
                    + " §7→ §b" + (portalUrl == null ? "/app/activations" : portalUrl));
        } else {
            reply(sender, "§7No active lease. Run §f/aegishider license link§7 to pair this server.");
        }
        if (config != null && config.telemetryEnabled()) {
            reply(sender, "§7Telemetry: §f" + (lastHeartbeatAt == 0 ? "not sent yet"
                    : "last sent " + Instant.ofEpochSecond(lastHeartbeatAt)) + "§7, buffered events: §f"
                    + eventBuffer.size() + (droppedEvents.get() > 0 ? " §c(dropped " + droppedEvents.get() + ")" : ""));
        }
        if (lastError != null) {
            reply(sender, "§cLast error: §f" + lastError);
        }
    }

    private long remainingMinutes() {
        return Math.max(0, (leaseExpiresAt - CanonicalRequest.nowSeconds()) / 60);
    }

    private boolean refreshLease() {
        try {
            ensureIdentity();
            PlatformClient.LeaseResponse response = client().requestLease(plugin.getPluginMeta().getVersion());
            Map<String, java.security.PublicKey> keys = new java.util.LinkedHashMap<>(response.keys());
            String extraFingerprint = config.trustedKeySha256();
            keys.entrySet().removeIf(entry ->
                    !PlatformTrust.isTrusted(entry.getKey(), entry.getValue(), extraFingerprint));
            if (keys.isEmpty()) {
                throw new java.security.GeneralSecurityException(
                        "platform returned no pinned signing key (refusing a rogue lease anchor)");
            }
            long now = CanonicalRequest.nowSeconds();
            LeaseVerifier.Lease verified = LeaseVerifier.verify(response.lease(), keys,
                    identity.installationUuid(), config.product(), now, 300);
            lease = verified;
            leaseExpiresAt = verified.expiresAt();
            offlineGraceSeconds = clampGraceSeconds(response.offlineGraceHours());
            serverTimeHighWatermark = Math.max(serverTimeHighWatermark, Math.max(now, response.serverTime()));
            leaseSource = "live";
            expiryNotified = false;
            state = "ACTIVE";
            lastError = null;
            saveLeaseState(response, keys);
            plugin.getLogger().info("Platform license active: " + verified.claims().get("license_id")
                    + " (expires " + Instant.ofEpochSecond(verified.expiresAt()) + ")");
            plugin.onLicenseActivated();
            return true;
        } catch (PlatformClient.PlatformApiException exception) {
            if (exception.status() == 403 || exception.status() == 404) {
                state = activationCode == null ? "UNLICENSED" : "PENDING_ACTIVATION";
                lastError = "license not active (HTTP " + exception.status() + ")";
                // An explicit refusal shortens the offline tail: a revoked or deactivated
                // licence must not keep protecting for the full grace window.
                offlineGraceSeconds = 0;
            } else {
                state = "ERROR";
                lastError = "platform error (HTTP " + exception.status() + ")";
            }
            return false;
        } catch (Throwable throwable) {
            long now = CanonicalRequest.nowSeconds();
            if (hasUsableLease(now)) {
                state = "ACTIVE";
                if ("none".equals(leaseSource)) {
                    leaseSource = "cached";
                }
            } else {
                state = "OFFLINE";
            }
            lastError = throwable.getMessage();
            plugin.getLogger().log(Level.FINE, "Platform lease refresh failed: " + throwable.getMessage(), throwable);
            return false;
        }
    }

    private void heartbeat() {
        try {
            if (!hasUsableLease(CanonicalRequest.nowSeconds())) {
                return;
            }
            PlatformConfig current = config;
            if (current == null || !current.telemetryEnabled()) {
                return;
            }
            Map<String, Object> metrics = new LinkedHashMap<>();
            metrics.put("tps", Bukkit.getTPS()[0]);
            metrics.put("players_online", Bukkit.getOnlinePlayers().size());
            metrics.put("errors", 0);

            List<String> modules = new ArrayList<>();
            if (plugin.blockProtectionActive()) {
                modules.add("block-protection");
            }
            if (plugin.config().anyItemProtectionEnabled()) {
                modules.add("item-protection");
            }
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("schema_version", 1);
            payload.put("plugin_version", plugin.getPluginMeta().getVersion());
            payload.put("minecraft_version", Bukkit.getMinecraftVersion());
            payload.put("platform", "Paper");
            payload.put("java_version", System.getProperty("java.version"));
            payload.put("enabled_modules", modules);
            payload.put("metrics", metrics);
            IntegrityGuard.Result currentIntegrity = integrity;
            payload.put("jar_sha256", currentIntegrity == null || currentIntegrity.actualSha256() == null
                    ? "" : currentIntegrity.actualSha256());
            payload.put("build_target", BuildInfo.target());
            payload.put("occurred_at", CanonicalRequest.nowSeconds());
            client().heartbeat(payload);
            lastHeartbeatAt = CanonicalRequest.nowSeconds();
        } catch (Throwable throwable) {
            plugin.getLogger().log(Level.FINE, "Platform heartbeat failed: " + throwable.getMessage(), throwable);
        }
    }

    /** Records a bounded operational event for the next telemetry flush. */
    public void recordEvent(String type, String severity, String message, Map<String, Object> attributes) {
        try {
            PlatformConfig current = config;
            if (current == null || !current.telemetryEnabled()) {
                return;
            }
            Map<String, Object> event = new LinkedHashMap<>();
            event.put("event_id", java.util.UUID.randomUUID().toString());
            event.put("type", type);
            event.put("severity", severity);
            event.put("occurred_at", CanonicalRequest.nowSeconds());
            event.put("message", message.length() > 500 ? message.substring(0, 500) : message);
            if (attributes != null && !attributes.isEmpty()) {
                event.put("attributes", attributes);
            }
            eventBuffer.addLast(event);
            while (eventBuffer.size() > current.maxBuffer()) {
                eventBuffer.pollFirst();
                droppedEvents.incrementAndGet();
            }
        } catch (Throwable ignored) {
            // Telemetry must never affect gameplay or security.
        }
    }

    private void flushEvents() {
        try {
            PlatformConfig current = config;
            if (current == null || !current.telemetryEnabled() || eventBuffer.isEmpty()) {
                return;
            }
            List<Map<String, Object>> batch = new ArrayList<>();
            while (batch.size() < current.batchMax() && !eventBuffer.isEmpty()) {
                Map<String, Object> event = eventBuffer.pollFirst();
                if (event != null) {
                    batch.add(event);
                }
            }
            if (batch.isEmpty()) {
                return;
            }
            try {
                client().events(batch);
            } catch (Throwable throwable) {
                // Re-queue at the front (bounded) and retry on the next flush.
                for (int i = batch.size() - 1; i >= 0; i--) {
                    eventBuffer.addFirst(batch.get(i));
                }
                // Same policy as recordEvent: drop the oldest event, never the newest, so a
                // retry backlog keeps the most recent operational context.
                while (eventBuffer.size() > current.maxBuffer()) {
                    eventBuffer.pollFirst();
                    droppedEvents.incrementAndGet();
                }
                throw throwable;
            }
        } catch (Throwable throwable) {
            plugin.getLogger().log(Level.FINE, "Platform telemetry flush failed: " + throwable.getMessage(), throwable);
        }
    }

    private void ensureIdentity() throws IOException, GeneralSecurityException {
        if (identity == null) {
            identity = InstallationIdentity.loadOrCreate(directory);
        }
        if (client == null) {
            client = new PlatformClient(config.apiBaseUrl(), config.product(),
                    config.requestTimeoutSeconds(), identity);
        }
    }

    private PlatformClient client() {
        if (client == null) {
            throw new IllegalStateException("platform client is not initialized");
        }
        return client;
    }

    private void fail(String message, Throwable throwable) {
        state = "ERROR";
        lastError = message + ": " + throwable.getMessage();
        plugin.getLogger().log(Level.WARNING, "Aegishider platform: " + lastError, throwable);
    }

    private void fail(CommandSender sender, String message, Throwable throwable) {
        fail(message, throwable);
        reply(sender, "§c" + lastError);
    }

    private void reply(CommandSender sender, String message) {
        try {
            if (!plugin.isEnabled()) {
                return;
            }
            // RCON and console commands run on the main thread: reply synchronously so
            // command output is captured. Async callbacks are scheduled back on it.
            if (plugin.getServer().isPrimaryThread()) {
                sender.sendMessage(message);
                return;
            }
            if (plugin.getServer().getScheduler() != null) {
                plugin.getServer().getScheduler().runTask(plugin, () -> sender.sendMessage(message));
            } else {
                sender.sendMessage(message);
            }
        } catch (Throwable ignored) {
            // Sender may have disconnected or the server is stopping.
        }
    }

    /** True when the platform configuration demands a verified lease before protection. */
    public boolean requiresLicense() {
        PlatformConfig current = config;
        if (current == null) {
            // The config could not be loaded: never assume the owner opted out.
            return configError;
        }
        return current.enabled() && current.enforcement() == PlatformConfig.Enforcement.ENFORCE;
    }

    /** Runtime gate: true while a live or cached signed lease is inside its grace window. */
    public boolean protectionAllowed() {
        PlatformConfig current = config;
        if (current == null) {
            return false;
        }
        if (!current.enabled() || current.enforcement() != PlatformConfig.Enforcement.ENFORCE) {
            return true;
        }
        return hasUsableLease(CanonicalRequest.nowSeconds());
    }

    private static long clampGraceSeconds(long hours) {
        return Math.max(0, Math.min(hours, 168)) * 3600L;
    }

    private boolean hasUsableLease(long now) {
        return lease != null && now <= leaseExpiresAt + offlineGraceSeconds;
    }

    private void loadPersistedLease() {
        try {
            LeaseState.Stored stored = LeaseState.load(directory.resolve("lease-state.json"),
                    identity, config.product(), config.trustedKeySha256(),
                    CanonicalRequest.nowSeconds(), 300);
            if (stored == null) {
                return;
            }
            lease = stored.lease();
            leaseExpiresAt = stored.lease().expiresAt();
            offlineGraceSeconds = stored.graceSeconds();
            serverTimeHighWatermark = Math.max(serverTimeHighWatermark, stored.highWatermark());
            leaseSource = "cached";
            state = "ACTIVE";
            plugin.getLogger().info("Restored signed license lease from cache (expires "
                    + Instant.ofEpochSecond(leaseExpiresAt) + ", offline grace "
                    + (offlineGraceSeconds / 3600) + "h).");
            plugin.onLicenseActivated();
        } catch (Throwable throwable) {
            plugin.getLogger().warning("Cached license lease could not be used: "
                    + throwable.getMessage());
        }
    }

    private void saveLeaseState(PlatformClient.LeaseResponse response,
                                Map<String, java.security.PublicKey> trustedKeys) {
        try {
            LeaseState.save(directory.resolve("lease-state.json"), response.lease(),
                    response.keyId(), leaseExpiresAt, response.serverTime(),
                    offlineGraceSeconds / 3600, serverTimeHighWatermark, identity,
                    config.product(), trustedKeys);
        } catch (Throwable throwable) {
            // Never fail a valid refresh because the cache could not be written.
            plugin.getLogger().log(Level.FINE, "Could not persist the license lease: "
                    + throwable.getMessage(), throwable);
        }
    }

    private void enforceLease() {
        try {
            if (!requiresLicense() || lease == null || expiryNotified) {
                return;
            }
            long now = CanonicalRequest.nowSeconds();
            if (now <= leaseExpiresAt + offlineGraceSeconds) {
                return;
            }
            expiryNotified = true;
            state = "EXPIRED";
            lastError = "license expired beyond the offline grace";
            plugin.getLogger().severe("Aegishider license expired beyond the offline grace ("
                    + (offlineGraceSeconds / 3600) + "h). Protection will be disabled.");
            plugin.onLicenseExpired();
        } catch (Throwable throwable) {
            plugin.getLogger().log(Level.FINE, "License enforcement check failed: "
                    + throwable.getMessage(), throwable);
        }
    }

    public String state() {
        return state;
    }

    public LeaseVerifier.Lease lease() {
        return lease;
    }

    public int bufferedEvents() {
        return eventBuffer.size();
    }
}
