package dev.audismp.aegishider.command;

import dev.audismp.aegishider.AegishiderPlugin;
import dev.audismp.aegishider.config.AegishiderConfig;
import dev.audismp.aegishider.core.ViewerSession;
import dev.audismp.aegishider.core.WorldKeys;
import dev.audismp.aegishider.index.HiddenBlockIndex;
import dev.audismp.aegishider.occlusion.OcclusionEngine;
import dev.audismp.aegishider.packet.PacketGateway;
import dev.audismp.aegishider.util.BlockPosUtil;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * /aegishider administration. Every reported value comes from the live system: module
 * states are derived from the same flags the security path checks, so the command cannot
 * report "ON" for an inactive module.
 */
public final class AegishiderCommand implements CommandExecutor, TabCompleter {

    private static final List<String> SUBCOMMANDS = List.of(
            "status", "diag", "viewer", "export", "deep", "stats", "verify", "rescan", "reload",
            "license", "help");

    private final AegishiderPlugin plugin;

    public AegishiderCommand(AegishiderPlugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public boolean onCommand(@NotNull CommandSender sender, @NotNull Command command,
                             @NotNull String label, @NotNull String[] args) {
        if (!sender.hasPermission("aegishider.admin")) {
            sender.sendMessage("§cAegishider: no permission.");
            return true;
        }
        String sub = args.length == 0 ? "status" : args[0].toLowerCase(Locale.ROOT);
        if (!plugin.protectionStarted() && !sub.equals("status")
                && !sub.equals("license") && !sub.equals("help")) {
            sender.sendMessage("§cAegishider protection is waiting for licence activation.");
            sender.sendMessage("§7Run §f/aegishider license link§7, enter the code in the portal, "
                    + "then run §f/aegishider license refresh§7.");
            return true;
        }
        switch (sub) {
            case "status" -> status(sender);
            case "diag" -> diag(sender);
            case "viewer" -> viewer(sender, args);
            case "export" -> export(sender);
            case "deep" -> deep(sender);
            case "stats" -> stats(sender);
            case "verify" -> verify(sender);
            case "rescan" -> requireThen(sender, "aegishider.admin.diagnostics", () -> rescan(sender));
            case "reload" -> reload(sender);
            case "license" -> requireThen(sender, "aegishider.admin.license", () -> license(sender, args));
            case "help" -> help(sender);
            default -> sender.sendMessage("§cUnknown subcommand. " + usage());
        }
        return true;
    }

    /** Separate node per sensitive action so admins can grant them individually. */
    private void requireThen(CommandSender sender, String permission, Runnable action) {
        if (!sender.hasPermission(permission)) {
            sender.sendMessage("§cAegishider: no permission (" + permission + ").");
            return;
        }
        action.run();
    }

    private String usage() {
        return "Usage: /aegishider <status|diag|viewer [player]|export|deep|stats|verify|rescan|reload|license [status|link|refresh]|help>";
    }

    private void license(CommandSender sender, String[] args) {
        if (plugin.platformService() == null) {
            sender.sendMessage("§cPlatform client is not initialized. Check the server console and platform.yml.");
            return;
        }
        plugin.platformService().handle(sender, args);
    }

    private void help(CommandSender sender) {
        sender.sendMessage("§6§lAegishider " + plugin.getPluginMeta().getVersion());
        sender.sendMessage("§e/aegishider status §7- module state, gateway, protected data counts");
        sender.sendMessage("§e/aegishider diag §7- live metrics and engine diagnostics");
        sender.sendMessage("§e/aegishider viewer [player] §7- why you/another viewer do or do not see protected data");
        sender.sendMessage("§e/aegishider deep §7- async diagnostics (never blocks the main thread)");
        sender.sendMessage("§e/aegishider stats §7- security counters since start");
        sender.sendMessage("§e/aegishider verify §7- runtime invariant self-check");
        sender.sendMessage("§e/aegishider export §7- write diagnostics.json asynchronously");
        sender.sendMessage("§e/aegishider rescan §7- re-discover loaded chunks now (admin tool)");
        sender.sendMessage("§e/aegishider reload §7- reload config and re-scan loaded chunks");
        sender.sendMessage("§e/aegishider license status §7- licence state, installation and lease expiry");
        sender.sendMessage("§e/aegishider license link §7- print the activation code for the customer portal");
        sender.sendMessage("§e/aegishider license refresh §7- fetch a new signed lease now");
        sender.sendMessage("§e/aegishider license verify §7- print the jar SHA-256 and integrity pin state");
        sender.sendMessage("§7Bypass: §faegishider.bypass §7(per-world configurable; NOT granted to OPs by default)");
    }

    private void status(CommandSender sender) {
        AegishiderConfig config = plugin.config();
        PacketGateway gateway = plugin.packetGateway();
        sender.sendMessage("§6§l--- Aegishider status ---");
        sender.sendMessage("§7Version: §f" + plugin.getPluginMeta().getVersion()
                + "§7 | config revision: §f" + config.revision());
        sender.sendMessage("§7Protection gate: §f"
                + (plugin.protectionStarted() ? "§aOPEN" : "§cWAITING FOR LICENCE ACTIVATION"));
        sender.sendMessage("§7Packet gateway: §f" + (gateway == null ? "MISSING" : gateway.statusLine()));
        sender.sendMessage("§7Block protection: §f"
                + (plugin.blockProtectionActive() ? "§aACTIVE" : "§cINACTIVE"));
        sender.sendMessage("§7Item/entity protection: §f"
                + (plugin.protectionStarted() && config.anyItemProtectionEnabled() ? "§aACTIVE" : "§cINACTIVE")
                + " §7(tracked entities: §f" + plugin.itemShield().trackedCount() + "§7: "
                + plugin.itemShield().trackedTypeSummary() + ")");
        sender.sendMessage("§7Protected blocks: §f" + plugin.hiddenBlockIndex().totalBlockCount()
                + " §7in §f" + plugin.hiddenBlockIndex().totalChunkCount() + " §7chunks");
        sender.sendMessage("§7Loaded worlds: §f" + plugin.getServer().getWorlds().size()
                + " §7| viewer sessions: §f" + plugin.sessions().size());
        int bypassViewers = 0;
        for (ViewerSession session : plugin.sessions().all()) {
            Player viewer = session.player();
            if (viewer == null || !viewer.isOnline()) {
                continue;
            }
            if (session.bypass()) {
                bypassViewers++;
            }
            sender.sendMessage("§7- §f" + viewer.getName() + " §7bypass="
                    + (session.bypass() ? "§cYES" : "§ano")
                    + " §7client=§f" + (gateway == null ? "?" : gateway.clientVersion(viewer))
                    + " §7revealedBlocks=§f" + plugin.blockVisibility().revealedCount(viewer.getUniqueId())
                    + " §7revealedItems=§f" + plugin.itemShield().revealedCountFor(viewer.getUniqueId()));
        }
        if (bypassViewers > 0) {
            sender.sendMessage("§cWARNING: §e" + bypassViewers
                    + " online viewer(s) have bypass permission and see everything. "
                    + "Grant aegishider.bypass only to trusted staff.");
        }
        sender.sendMessage("§7Config warnings: §f" + config.warnings().size()
                + (config.warnings().isEmpty() ? "" : " §7(see console on load)"));
        if (plugin.protectionStarted() && !plugin.blockProtectionActive()
                && config.anyBlockProtectionEnabled()) {
            sender.sendMessage("§cBlock protection is configured but inactive: the packet summary "
                    + "cannot guarantee that container data never reaches a client. Install "
                    + "PacketEvents and restart.");
        }
        sender.sendMessage("§6§l-----------------------");
    }

    /**
     * Explains, for one viewer, why protected data is or is not visible: bypass state,
     * client protocol (ViaVersion), reveal counters, and the nearest protected block with
     * its distance / reveal decision. This is the fastest way to distinguish "plugin broken"
     * from "you are bypassing / standing inside the reveal radius / looking at your own item".
     */
    private void viewer(CommandSender sender, String[] args) {
        Player target = null;
        if (args.length > 1) {
            target = plugin.getServer().getPlayerExact(args[1]);
        } else if (sender instanceof Player player) {
            target = player;
        }
        AegishiderConfig config = plugin.config();
        if (target == null) {
            sender.sendMessage("§6§l--- Aegishider viewers ---");
            for (ViewerSession session : plugin.sessions().all()) {
                Player viewer = session.player();
                if (viewer == null || !viewer.isOnline()) {
                    continue;
                }
                sender.sendMessage("§7- §f" + viewer.getName() + " §7world=§f" + viewer.getWorld().getName()
                        + " §7bypass=" + (session.bypass() ? "§cYES" : "§ano")
                        + " §7client=§f" + (plugin.packetGateway() == null ? "?"
                        : plugin.packetGateway().clientVersion(viewer)));
            }
            sender.sendMessage("§7Usage: /aegishider viewer <player>");
            return;
        }
        World world = target.getWorld();
        var settings = config.world(world.getName());
        ViewerSession session = plugin.sessions().get(target.getUniqueId());
        if (session == null) {
            sender.sendMessage("§cNo viewer session for §f" + target.getName()
                    + "§c yet (join/teleport not processed). Try again in a moment.");
            return;
        }
        boolean bypass = target.hasPermission(settings.bypassPermission());
        String client = plugin.packetGateway() == null ? "unknown"
                : plugin.packetGateway().clientVersion(target);
        sender.sendMessage("§6§l--- Aegishider viewer: " + target.getName() + " ---");
        sender.sendMessage("§7World: §f" + world.getName()
                + " §7| bypass: " + (bypass ? "§cYES (protection not applied)" : "§ano")
                + " §7| client protocol: §f" + client);
        sender.sendMessage("§7Gateway: §f" + (plugin.blockProtectionActive()
                ? "§aACTIVE" : "§cINACTIVE") + " §7| block config enabled: §f"
                + settings.blocksEnabled() + " §7| item config enabled: §f" + settings.itemsEnabled());
        sender.sendMessage("§7Revealed markers: §fblocks=" + plugin.blockVisibility().revealedCount(target.getUniqueId())
                + " §7items=" + plugin.itemShield().revealedCountFor(target.getUniqueId())
                + " §7| tracked items (all viewers): §f" + plugin.itemShield().trackedCount());
        long nearest = findNearestProtectedBlock(target);
        if (nearest == Long.MIN_VALUE) {
            sender.sendMessage("§7Nearest protected block: §fnone within 64 blocks (loaded/indexed chunks)");
        } else {
            int x = BlockPosUtil.decodeX(nearest);
            int y = BlockPosUtil.decodeY(nearest);
            int z = BlockPosUtil.decodeZ(nearest);
            double distance = Math.sqrt(Math.pow(x + 0.5 - session.eyeX(), 2)
                    + Math.pow(y + 0.5 - session.eyeY(), 2)
                    + Math.pow(z + 0.5 - session.eyeZ(), 2));
            boolean revealed = plugin.blockVisibility().isRevealed(target.getUniqueId(), nearest);
            boolean fovDisabled = settings.blockProtection().fovCosHalf() < 0.0;
            boolean inFov = OcclusionEngine.insideFov(session, x + 0.5, y + 0.5, z + 0.5,
                    settings.blockProtection().fovCosHalf());
            Material chosenFiller = plugin.hiddenBlockIndex().filler(WorldKeys.idOf(world), nearest,
                    settings.blockProtection().replaceWith());
            sender.sendMessage("§7Nearest protected block: §f" + x + "," + y + "," + z
                    + " §7distance: §f" + String.format("%.1f", distance)
                    + " §7| state: " + (revealed ? "§aVISIBLE (revealed)" : "§cHIDDEN")
                    + " §7| filler: §f" + chosenFiller.name()
                    + " §7| in FOV: §f" + inFov);
            if (revealed) {
                sender.sendMessage("§7Why visible: §fwithin reveal distance §e"
                        + settings.blockProtection().revealDistance()
                        + (fovDisabled
                        ? "§f, FOV gate disabled and not occluded. This is intentional: nearby "
                        + "blocks are sent so legitimate interaction works."
                        : "§f, inside the FOV cone and not occluded. This is intentional: nearby "
                        + "blocks are sent so legitimate interaction works."));
            } else if (distance > settings.blockProtection().revealDistance()) {
                sender.sendMessage("§7Why hidden: §fdistance > reveal-distance §e"
                        + settings.blockProtection().revealDistance());
            } else if (!inFov) {
                sender.sendMessage("§7Why hidden: §fnot currently in the FOV cone (§e"
                        + settings.blockProtection().fovDegrees() + "°§f)");
            } else {
                sender.sendMessage("§7Why hidden: §fawaiting a visibility raycast/reveal decision "
                        + "(shared raycast budget; fail-closed until proven visible).");
            }
        }
        if (settings.itemsEnabled()) {
            sender.sendMessage("§7Item rules: reveal-distance=§f" + settings.itemProtection().revealDistance()
                    + " §7| owner-grace=§f" + settings.itemProtection().ownerGrace()
                    + (settings.itemProtection().ownerGrace()
                    ? " §7(items you throw are visible to you immediately by design)" : ""));
        }
        if (bypass) {
            sender.sendMessage("§cThis viewer bypasses Aegishider. Remove aegishider.bypass / deop "
                    + "or use a second non-staff account to verify protection.");
        }
        if (plugin.packetGateway() != null) {
            sender.sendMessage("§7Packet counters: §fchunkSanitized=" + plugin.metrics().chunkPacketsSanitized()
                    + " failClosed=" + plugin.metrics().chunkPacketsBlockedFailClosed()
                    + " blockFaked=" + plugin.metrics().blockChangesFaked()
                    + " itemSpawnBlocked=" + plugin.metrics().itemSpawnPacketsBlocked());
        }
        sender.sendMessage("§6§l-----------------------");
    }

    /** Nearest protected position within a 9x9 chunk square; Integer.MIN_VALUE when none. */
    private long findNearestProtectedBlock(Player player) {
        World world = player.getWorld();
        long worldId = WorldKeys.idOf(world);
        if (worldId == WorldKeys.UNKNOWN) {
            return Long.MIN_VALUE;
        }
        int centerX = player.getLocation().getBlockX() >> 4;
        int centerZ = player.getLocation().getBlockZ() >> 4;
        double best = Double.MAX_VALUE;
        long bestPos = Long.MIN_VALUE;
        for (int dx = -4; dx <= 4; dx++) {
            for (int dz = -4; dz <= 4; dz++) {
                HiddenBlockIndex.ChunkView view = plugin.hiddenBlockIndex()
                        .chunkView(worldId, centerX + dx, centerZ + dz);
                if (view == null) {
                    continue;
                }
                for (long pos : view.positions()) {
                    double distance = Math.pow(BlockPosUtil.decodeX(pos) + 0.5 - player.getX(), 2)
                            + Math.pow(BlockPosUtil.decodeY(pos) + 0.5 - player.getY(), 2)
                            + Math.pow(BlockPosUtil.decodeZ(pos) + 0.5 - player.getZ(), 2);
                    if (distance < best) {
                        best = distance;
                        bestPos = pos;
                    }
                }
            }
        }
        return bestPos;
    }

    private void diag(CommandSender sender) {
        var metrics = plugin.metrics();
        sender.sendMessage("§6§l--- Aegishider diag ---");
        sender.sendMessage("§7Security tick last/avg/max: §f" + metrics.lastTickNanos() / 1000 + " / "
                + metrics.averageTickNanos() / 1000 + " / " + metrics.maxTickNanos() / 1000 + " us"
                + " §7| p50/p95/p99: §f" + metrics.tickPercentileNanos(0.50) / 1000 + "/"
                + metrics.tickPercentileNanos(0.95) / 1000 + "/"
                + metrics.tickPercentileNanos(0.99) / 1000 + " us"
                + " §7| overruns: §f" + metrics.tickOverruns());
        sender.sendMessage("§7Engine time (item/block) last: §f"
                + metrics.lastItemDecisionNanos() / 1000 + "/"
                + metrics.lastBlockDecisionNanos() / 1000 + " us §7max: §f"
                + metrics.maxItemDecisionNanos() / 1000 + "/"
                + metrics.maxBlockDecisionNanos() / 1000 + " us");
        sender.sendMessage("§7Raycasts: §f" + metrics.raycasts()
                + " §7| deferred by budget: §f" + metrics.raycastBudgetDeferred()
                + " §7| budget remaining: §f" + plugin.raycastBudget().remaining()
                + "/" + plugin.raycastBudget().limit());
        sender.sendMessage("§7Item engine: §f" + plugin.itemShield().diagnostics() + " evals=" + metrics.itemEvaluations());
        sender.sendMessage("§7Block engine: §f" + plugin.blockShield().diagnostics() + " evals=" + metrics.blockEvaluations());
        sender.sendMessage("§7Discovery queue: §f" + plugin.blockDiscovery().pendingCount()
                + " §7| resync pending: §f" + plugin.blockVisibility().pendingResyncCount()
                + " §7| occlusion rev: §f" + plugin.blockShield().occlusionRevision().get());
        sender.sendMessage("§7Async: §fsubmitted=" + metrics.asyncTasks()
                + " rejected=" + metrics.asyncRejections()
                + " queue=" + metrics.asyncQueueSize() + "/" + metrics.asyncQueueCapacity()
                + " threads=" + metrics.asyncThreads());
        sender.sendMessage("§7Errors/config warnings: §f" + metrics.internalErrors()
                + "/" + metrics.configWarnings());
        sender.sendMessage("§7Gateway: §f" + plugin.packetGateway().diagnostics());
        sender.sendMessage("§7Maintenance: §f"
                + (plugin.diagnosticsExporter() == null ? "n/a" : plugin.diagnosticsExporter().diagnostics())
                + " §7| item storms: §f" + metrics.itemStormBatches()
                + " maxDepth=" + metrics.itemStormMaxDepth());
        sender.sendMessage("§7Gateway watchdog: silent="
                + (plugin.gatewayWatchdog() == null ? "n/a"
                : plugin.gatewayWatchdog().silentForMs(System.currentTimeMillis()) + "ms")
                + " §7| detected pending/overflow: §f" + plugin.packetGateway().detectedPendingCount()
                + "/" + plugin.packetGateway().detectedOverflowCount());
        sender.sendMessage("§7Index: §fw=§f" + plugin.hiddenBlockIndex().worldCount()
                + " blocks=" + plugin.hiddenBlockIndex().totalBlockCount()
                + " chunks=" + plugin.hiddenBlockIndex().totalChunkCount()
                + " indexRevision=" + plugin.hiddenBlockIndex().revision());
        sender.sendMessage("§6§l-----------------------");
    }

    private void export(CommandSender sender) {
        var exporter = plugin.diagnosticsExporter();
        if (exporter == null) {
            sender.sendMessage("§cMaintenance exporter is not available.");
            return;
        }
        exporter.collectAndSubmit();
        sender.sendMessage("§7Diagnostics snapshot scheduled asynchronously: §f" + exporter.outputFile());
    }

    private void deep(CommandSender sender) {
        sender.sendMessage("§7Running async diagnostics...");
        plugin.runAsyncDiagnostics(lines -> {
            sender.sendMessage("§6§l--- Aegishider deep diag (async) ---");
            for (String line : lines) {
                sender.sendMessage("§f" + line);
            }
            sender.sendMessage("§6§l-----------------------");
        });
    }

    private void stats(CommandSender sender) {
        var m = plugin.metrics();
        sender.sendMessage("§6§l--- Aegishider security counters ---");
        sender.sendMessage("§7Chunk packets sanitized/fail-closed/passed: §f" + m.chunkPacketsSanitized()
                + "/" + m.chunkPacketsBlockedFailClosed() + "/" + m.chunkPacketsPassed());
        sender.sendMessage("§7Block updates faked: §f" + m.blockChangesFaked()
                + " §7| block entity/action blocked: §f" + m.blockEntityPacketsBlocked()
                + "/" + m.blockActionPacketsBlocked());
        sender.sendMessage("§7Blocks revealed/re-hidden: §f" + m.blocksRevealed() + "/" + m.blocksRehidden());
        sender.sendMessage("§7Items tracked/untracked: §f" + m.itemsTracked() + "/" + m.itemsUntracked());
        sender.sendMessage("§7Item spawn/state packets blocked: §f" + m.itemSpawnPacketsBlocked()
                + "/" + m.itemStatePacketsBlocked()
                + " §7| untracked item spawns blocked: §f" + m.unexpectedItemSpawnPacketsBlocked());
        sender.sendMessage("§7Entity items reveals/hides: §f" + m.itemReveals() + "/" + m.itemHides()
                + " §7| entity packets cancelled: §f" + m.entityPacketsCancelled());
        sender.sendMessage("§7Hidden block registrations: §f" + m.hiddenBlocksRegistered()
                + " §7removals: §f" + m.hiddenBlocksRemoved());
        sender.sendMessage("§7Internal errors: §f" + m.internalErrors());
        sender.sendMessage("§6§l-----------------------");
    }

    private void verify(CommandSender sender) {
        List<String> problems = plugin.verify();
        sender.sendMessage("§6§l--- Aegishider verify ---");
        if (problems.isEmpty()) {
            sender.sendMessage("§aPASS: no invariant violations detected.");
        } else {
            sender.sendMessage("§cFAIL: " + problems.size() + " problem(s):");
            for (String problem : problems) {
                sender.sendMessage("§c - §f" + problem);
            }
        }
        sender.sendMessage("§7Note: this is a runtime self-check, not a packet-level proof. "
                + "Use the integration test harness for packet evidence.");
        sender.sendMessage("§6§l-----------------------");
    }

    private void rescan(CommandSender sender) {
        long start = System.nanoTime();
        int processed = plugin.rescanLoadedChunks(8192);
        long millis = (System.nanoTime() - start) / 1_000_000L;
        sender.sendMessage("§aAegishider rescan: §f" + processed + " §achunks processed in §f"
                + millis + " ms; protected blocks=§f" + plugin.hiddenBlockIndex().totalBlockCount());
    }

    private void reload(CommandSender sender) {
        try {
            plugin.reloadEverything();
            AegishiderConfig config = plugin.config();
            sender.sendMessage("§aAegishider reloaded. §7config revision " + config.revision()
                    + ", warnings " + config.warnings().size()
                    + ", block protection " + (plugin.blockProtectionActive() ? "§aACTIVE" : "§cINACTIVE"));
            for (String warning : config.warnings()) {
                sender.sendMessage("§e - " + warning);
            }
        } catch (Throwable throwable) {
            plugin.getLogger().log(java.util.logging.Level.SEVERE, "Reload failed", throwable);
            sender.sendMessage("§cReload failed: " + throwable.getMessage());
        }
    }

    @Override
    public @Nullable List<String> onTabComplete(@NotNull CommandSender sender, @NotNull Command command,
                                                @NotNull String alias, @NotNull String[] args) {
        if (!sender.hasPermission("aegishider.admin")) {
            return List.of();
        }
        if (args.length == 1) {
            String prefix = args[0].toLowerCase(Locale.ROOT);
            List<String> matches = new ArrayList<>();
            for (String sub : SUBCOMMANDS) {
                if (sub.startsWith(prefix)) {
                    matches.add(sub);
                }
            }
            return matches;
        }
        return List.of();
    }
}
