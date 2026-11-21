package dev.audismp.aegishider.maintenance;

import dev.audismp.aegishider.AegishiderPlugin;

/**
 * Immutable, main-thread-collected snapshot of operational metrics. Rendering it to JSON is
 * pure and can run on the bounded async pool (non-security work only).
 */
public record DiagnosticsSnapshot(
        long generatedAtEpochMs,
        String pluginVersion,
        String serverVersion,
        int onlinePlayers,
        int onlineSessions,
        int trackedItems,
        int revealedItemViewerPairs,
        int hiddenBlocks,
        int sensitiveChunks,
        long hiddenBlocksRegistered,
        long hiddenBlocksRemoved,
        long tickLastUs,
        long tickAvgUs,
        long tickMaxUs,
        long tickP50Us,
        long tickP95Us,
        long tickP99Us,
        long tickOverruns,
        long raycasts,
        long raycastDeferred,
        long itemEvaluations,
        long itemStormBatches,
        long itemStormMaxDepth,
        long blockEvaluations,
        long asyncTasks,
        long asyncRejections,
        long chunkSanitized,
        long chunkPassed,
        long chunkFailClosed,
        long blockChangesFaked,
        long blockEntityPacketsBlocked,
        long blockActionPacketsBlocked,
        long itemSpawnPacketsBlocked,
        long unexpectedItemSpawnPacketsBlocked,
        int detectedPending,
        long detectedOverflow,
        long internalErrors,
        long configWarnings) {

    public static DiagnosticsSnapshot capture(AegishiderPlugin plugin) {
        var metrics = plugin.metrics();
        var gateway = plugin.packetGateway();
        return new DiagnosticsSnapshot(
                System.currentTimeMillis(),
                plugin.getPluginMeta().getVersion(),
                plugin.getServer().getVersion(),
                plugin.getServer().getOnlinePlayers().size(),
                plugin.sessions().size(),
                metrics.trackedItemCount(),
                metrics.revealedItemViewerPairs(),
                metrics.hiddenBlockCount(),
                metrics.sensitiveChunkCount(),
                metrics.hiddenBlocksRegistered(),
                metrics.hiddenBlocksRemoved(),
                metrics.lastTickNanos() / 1000,
                metrics.averageTickNanos() / 1000,
                metrics.maxTickNanos() / 1000,
                metrics.tickPercentileNanos(0.50) / 1000,
                metrics.tickPercentileNanos(0.95) / 1000,
                metrics.tickPercentileNanos(0.99) / 1000,
                metrics.tickOverruns(),
                metrics.raycasts(),
                metrics.raycastBudgetDeferred(),
                metrics.itemEvaluations(),
                metrics.itemStormBatches(),
                metrics.itemStormMaxDepth(),
                metrics.blockEvaluations(),
                metrics.asyncTasks(),
                metrics.asyncRejections(),
                metrics.chunkPacketsSanitized(),
                metrics.chunkPacketsPassed(),
                metrics.chunkPacketsBlockedFailClosed(),
                metrics.blockChangesFaked(),
                metrics.blockEntityPacketsBlocked(),
                metrics.blockActionPacketsBlocked(),
                metrics.itemSpawnPacketsBlocked(),
                metrics.unexpectedItemSpawnPacketsBlocked(),
                gateway == null ? 0 : gateway.detectedPendingCount(),
                gateway == null ? 0 : gateway.detectedOverflowCount(),
                metrics.internalErrors(),
                metrics.configWarnings());
    }

    public String toJson() {
        StringBuilder json = new StringBuilder(1024);
        json.append('{');
        appendNumber(json, "generatedAtEpochMs", generatedAtEpochMs, true);
        appendString(json, "pluginVersion", pluginVersion, true);
        appendString(json, "serverVersion", serverVersion, true);
        appendNumber(json, "onlinePlayers", onlinePlayers, true);
        appendNumber(json, "onlineSessions", onlineSessions, true);
        appendNumber(json, "trackedItems", trackedItems, true);
        appendNumber(json, "revealedItemViewerPairs", revealedItemViewerPairs, true);
        appendNumber(json, "hiddenBlocks", hiddenBlocks, true);
        appendNumber(json, "sensitiveChunks", sensitiveChunks, true);
        appendNumber(json, "hiddenBlocksRegistered", hiddenBlocksRegistered, true);
        appendNumber(json, "hiddenBlocksRemoved", hiddenBlocksRemoved, true);
        appendNumber(json, "tickLastUs", tickLastUs, true);
        appendNumber(json, "tickAvgUs", tickAvgUs, true);
        appendNumber(json, "tickMaxUs", tickMaxUs, true);
        appendNumber(json, "tickP50Us", tickP50Us, true);
        appendNumber(json, "tickP95Us", tickP95Us, true);
        appendNumber(json, "tickP99Us", tickP99Us, true);
        appendNumber(json, "tickOverruns", tickOverruns, true);
        appendNumber(json, "raycasts", raycasts, true);
        appendNumber(json, "raycastDeferred", raycastDeferred, true);
        appendNumber(json, "itemEvaluations", itemEvaluations, true);
        appendNumber(json, "itemStormBatches", itemStormBatches, true);
        appendNumber(json, "itemStormMaxDepth", itemStormMaxDepth, true);
        appendNumber(json, "blockEvaluations", blockEvaluations, true);
        appendNumber(json, "asyncTasks", asyncTasks, true);
        appendNumber(json, "asyncRejections", asyncRejections, true);
        appendNumber(json, "chunkSanitized", chunkSanitized, true);
        appendNumber(json, "chunkPassed", chunkPassed, true);
        appendNumber(json, "chunkFailClosed", chunkFailClosed, true);
        appendNumber(json, "blockChangesFaked", blockChangesFaked, true);
        appendNumber(json, "blockEntityPacketsBlocked", blockEntityPacketsBlocked, true);
        appendNumber(json, "blockActionPacketsBlocked", blockActionPacketsBlocked, true);
        appendNumber(json, "itemSpawnPacketsBlocked", itemSpawnPacketsBlocked, true);
        appendNumber(json, "unexpectedItemSpawnPacketsBlocked", unexpectedItemSpawnPacketsBlocked, true);
        appendNumber(json, "detectedPending", detectedPending, true);
        appendNumber(json, "detectedOverflow", detectedOverflow, true);
        appendNumber(json, "internalErrors", internalErrors, true);
        appendNumber(json, "configWarnings", configWarnings, false);
        json.append('}');
        return json.toString();
    }

    private static void appendNumber(StringBuilder json, String key, long value, boolean comma) {
        json.append('"').append(key).append("\":").append(value);
        if (comma) {
            json.append(',');
        }
    }

    static void appendString(StringBuilder json, String key, String value, boolean comma) {
        json.append('"').append(key).append("\":");
        if (value == null) {
            json.append("null");
        } else {
            json.append('"').append(escape(value)).append('"');
        }
        if (comma) {
            json.append(',');
        }
    }

    static String escape(String value) {
        StringBuilder escaped = new StringBuilder(value.length() + 8);
        for (int i = 0; i < value.length(); i++) {
            char character = value.charAt(i);
            switch (character) {
                case '"' -> escaped.append("\\\"");
                case '\\' -> escaped.append("\\\\");
                case '\n' -> escaped.append("\\n");
                case '\r' -> escaped.append("\\r");
                case '\t' -> escaped.append("\\t");
                default -> {
                    if (character < 0x20) {
                        escaped.append(String.format("\\u%04x", (int) character));
                    } else {
                        escaped.append(character);
                    }
                }
            }
        }
        return escaped.toString();
    }
}
