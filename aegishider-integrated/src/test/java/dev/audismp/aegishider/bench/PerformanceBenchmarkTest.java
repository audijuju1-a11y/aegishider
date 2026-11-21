package dev.audismp.aegishider.bench;

import com.github.retrooper.packetevents.protocol.player.ClientVersion;
import com.github.retrooper.packetevents.protocol.world.chunk.BaseChunk;
import com.github.retrooper.packetevents.protocol.world.chunk.Column;
import com.github.retrooper.packetevents.protocol.world.chunk.TileEntity;
import com.github.retrooper.packetevents.protocol.world.chunk.impl.v_1_18.Chunk_v1_18;
import com.github.retrooper.packetevents.protocol.world.chunk.palette.DataPalette;
import dev.audismp.aegishider.core.BoundedTaskExecutor;
import dev.audismp.aegishider.index.HiddenBlockIndex;
import dev.audismp.aegishider.metrics.Metrics;
import dev.audismp.aegishider.occlusion.OcclusionEngine;
import dev.audismp.aegishider.occlusion.RayTracer;
import dev.audismp.aegishider.packet.ChunkSanitizer;
import dev.audismp.aegishider.util.BlockPosUtil;
import org.bukkit.Material;
import org.junit.jupiter.api.Test;

import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Deterministic micro-benchmarks for the visibility decision primitives.
 *
 * <p>These measure Aegishider's own code paths on the build machine; they are not a
 * substitute for server MSPT benchmarking under real load. Results are printed with a
 * stable {@code BENCH} prefix so the engineering report can quote measured values.
 */
class PerformanceBenchmarkTest {

    private static final class FakeSection implements BaseChunk {
        final int[] states = new int[4096];

        @Override
        public int getBlockId(int x, int y, int z) {
            return states[(y << 8) | (z << 4) | x];
        }

        @Override
        public void set(int x, int y, int z, int stateId) {
            states[(y << 8) | (z << 4) | x] = stateId;
        }

        @Override
        public boolean isEmpty() {
            return false;
        }
    }

    private static void report(String name, double value, String unit) {
        System.out.println("BENCH " + name + " = " + String.format("%.2f", value) + " " + unit);
    }

    private static ChunkSanitizer.StateIdMapper stateScanMapper() {
        return new ChunkSanitizer.StateIdMapper() {
            @Override
            public String typeName(ClientVersion clientVersion, int stateId) {
                return switch (stateId) {
                    case 1 -> "minecraft:stone";
                    case 104 -> "minecraft:bookshelf";
                    case 0 -> "minecraft:air";
                    default -> null;
                };
            }

            @Override
            public int fillerStateId(ClientVersion clientVersion, Material fillerMaterial) {
                return 999;
            }
        };
    }

    /** Avoids PacketEvents' state registry (unavailable in the pure-unit-test JVM). */
    private static final class TestChunk extends Chunk_v1_18 {
        TestChunk() {
            super(ClientVersion.V_1_21_4, 0, 0, DataPalette.createForChunk(),
                    DataPalette.createForBiome());
            setBlockCount(4096);
        }

        @Override
        public void set(int x, int y, int z, int stateId) {
            getChunkData().set(x, y, z, stateId);
        }
    }

    private static Chunk_v1_18 realSection(boolean withBookshelf) {
        Chunk_v1_18 section = new TestChunk();
        for (int y = 0; y < 16; y++) {
            for (int x = 0; x < 16; x++) {
                for (int z = 0; z < 16; z++) {
                    section.getChunkData().set(x, y, z, 1);
                }
            }
        }
        if (withBookshelf) {
            section.getChunkData().set(4, 5, 6, 104);
        }
        return section;
    }

    private static Column stateScanColumn(boolean withBookshelf, int sectionCount) {
        BaseChunk[] sections = new BaseChunk[sectionCount];
        for (int i = 0; i < sections.length; i++) {
            sections[i] = realSection(withBookshelf && i == 0);
        }
        return new Column(0, 0, true, sections, new TileEntity[0]);
    }

    @Test
    void stateOnlyPalettePrefilterBenchmark() {
        System.out.println("BENCH stateScan sections=24 blocksPerChunk=" + (24 * 4096));
        Set<String> stateOnly = Set.of("bookshelf");
        ChunkSanitizer.StateIdMapper mapper = stateScanMapper();

        // No bookshelf in any section: the palette prefilter must avoid every 4096-block loop.
        Column noBookshelf = stateScanColumn(false, 24);
        int skipIterations = 20_000;
        long start = System.nanoTime();
        ChunkSanitizer.Result skipped = null;
        for (int i = 0; i < skipIterations; i++) {
            skipped = ChunkSanitizer.sanitize(noBookshelf, ClientVersion.V_1_21_4, 0,
                    null, null, Set.of(), Material.STONE, null, mapper, true, Set.of(), stateOnly);
        }
        long skipNanos = System.nanoTime() - start;
        report("stateScan.prefilterSkip", (double) skipNanos / skipIterations,
                "ns/chunk (sections=" + skipped.stateScan().sectionsVisited()
                        + ", scanned=" + skipped.stateScan().sectionsScanned()
                        + ", blocksRead=" + skipped.stateScan().blocksRead() + ")");
        assertFalse(skipped.rewritten());
        assertEquals(24, skipped.stateScan().sectionsPrefiltered());
        assertEquals(0, skipped.stateScan().blocksRead());
        assertTrue(skipped.stateScan().skippedAllSections());

        // One bookshelf section: only that section pays the 4096-block scan.
        Column oneBookshelf = stateScanColumn(true, 24);
        Chunk_v1_18 shelfSection = (Chunk_v1_18) oneBookshelf.getChunks()[0];
        int scanIterations = 2_000;
        start = System.nanoTime();
        ChunkSanitizer.Result scanned = null;
        for (int i = 0; i < scanIterations; i++) {
            shelfSection.getChunkData().set(4, 5, 6, 104);
            scanned = ChunkSanitizer.sanitize(oneBookshelf, ClientVersion.V_1_21_4, 0,
                    null, null, Set.of(), Material.STONE, null, mapper, true, Set.of(), stateOnly);
        }
        long scanNanos = System.nanoTime() - start;
        report("stateScan.oneMatchingSection", (double) scanNanos / scanIterations,
                "ns/chunk (sections=" + scanned.stateScan().sectionsVisited()
                        + ", scanned=" + scanned.stateScan().sectionsScanned()
                        + ", blocksRead=" + scanned.stateScan().blocksRead() + ")");
        assertTrue(scanned.rewritten());
        assertEquals(24, scanned.stateScan().sectionsVisited());
        assertEquals(23, scanned.stateScan().sectionsPrefiltered());
        assertEquals(1, scanned.stateScan().sectionsScanned());
        assertEquals(4096, scanned.stateScan().blocksRead());

        // Worst case: no finite palette, so every section takes the fallback scan.
        BaseChunk[] fallbackSections = new BaseChunk[24];
        for (int i = 0; i < fallbackSections.length; i++) {
            FakeSection section = new FakeSection();
            for (int block = 0; block < section.states.length; block++) {
                section.states[block] = 1;
            }
            fallbackSections[i] = section;
        }
        Column fallback = new Column(0, 0, true, fallbackSections, new TileEntity[0]);
        int fallbackIterations = 500;
        start = System.nanoTime();
        ChunkSanitizer.Result fallbackResult = null;
        for (int i = 0; i < fallbackIterations; i++) {
            fallbackResult = ChunkSanitizer.sanitize(fallback, ClientVersion.V_1_21_4, 0,
                    null, null, Set.of(), Material.STONE, null, mapper, true, Set.of(), stateOnly);
        }
        long fallbackNanos = System.nanoTime() - start;
        report("stateScan.fallbackFullChunk", (double) fallbackNanos / fallbackIterations,
                "ns/chunk (sections=" + fallbackResult.stateScan().sectionsVisited()
                        + ", scanned=" + fallbackResult.stateScan().sectionsScanned()
                        + ", blocksRead=" + fallbackResult.stateScan().blocksRead() + ")");
        assertFalse(fallbackResult.rewritten());
        assertEquals(24, fallbackResult.stateScan().sectionsScanned());
        assertEquals(24 * 4096, fallbackResult.stateScan().blocksRead());
    }

    @Test
    void runPrimitiveBenchmarks() {
        System.out.println("BENCH environment java=" + System.getProperty("java.version")
                + " os=" + System.getProperty("os.name") + " cpus="
                + Runtime.getRuntime().availableProcessors());

        // ── Block position encode/decode ───────────────────────────────────
        int ops = 5_000_000;
        long sink = 0;
        long start = System.nanoTime();
        for (int i = 0; i < ops; i++) {
            long pos = BlockPosUtil.encode(i, i & 0x3FF, -i);
            sink += BlockPosUtil.decodeX(pos) + BlockPosUtil.decodeY(pos) + BlockPosUtil.decodeZ(pos);
        }
        long encodeNanos = System.nanoTime() - start;
        report("blockpos.encode_decode", (double) encodeNanos / ops, "ns/op (sink=" + (sink & 1) + ")");

        // ── Hidden block index lookup ──────────────────────────────────────
        Metrics metrics = new Metrics();
        HiddenBlockIndex index = new HiddenBlockIndex(metrics);
        for (int chunk = 0; chunk < 200; chunk++) {
            for (int i = 0; i < 50; i++) {
                index.register(1L, BlockPosUtil.encode((chunk & 15) * 16 + (i % 16),
                        60 + (i / 16), (chunk >> 4) * 16 + (i % 16)));
            }
        }
        long[] probes = new long[50];
        for (int i = 0; i < probes.length; i++) {
            probes[i] = BlockPosUtil.encode(i % 16, 60, i / 16);
        }
        int lookups = 2_000_000;
        int hits = 0;
        start = System.nanoTime();
        for (int i = 0; i < lookups; i++) {
            if (index.isHidden(1L, probes[i % probes.length])) {
                hits++;
            }
        }
        report("index.isHidden", (double) (System.nanoTime() - start) / lookups, "ns/op (hits=" + hits + ")");

        HiddenBlockIndex.ChunkView view = index.chunkView(1L, 0, 0);
        int contains = 1_000_000;
        int contained = 0;
        start = System.nanoTime();
        for (int i = 0; i < contains; i++) {
            if (view.contains(probes[i % probes.length])) {
                contained++;
            }
        }
        report("chunkview.contains", (double) (System.nanoTime() - start) / contains,
                "ns/op (hits=" + contained + ")");

        // ── Field of view math ─────────────────────────────────────────────
        int fovOps = 20_000_000;
        int inside = 0;
        double cos = Math.cos(Math.toRadians(65));
        start = System.nanoTime();
        for (int i = 0; i < fovOps; i++) {
            if (OcclusionEngine.insideFov(0, 0, 0, 1, 0, 0,
                    i % 40 - 20, 3, 10, cos)) {
                inside++;
            }
        }
        report("occlusion.insideFov", (double) (System.nanoTime() - start) / fovOps,
                "ns/op (inside=" + inside + ")");

        // ── Ray traced line of sight (fake tracer, measures policy overhead) ─
        RayTracer tracer = (world, ex, ey, ez, tx, ty, tz) -> false;
        OcclusionEngine occlusion = new OcclusionEngine(tracer);
        int rayOps = 5_000_000;
        int visible = 0;
        start = System.nanoTime();
        for (int i = 0; i < rayOps; i++) {
            if (occlusion.hasLineOfSight(null, 0, 0, 0, 10, 2, 4)) {
                visible++;
            }
        }
        report("occlusion.policyCheck", (double) (System.nanoTime() - start) / rayOps,
                "ns/op (visible=" + visible + ")");

        // ── Chunk sanitization (20 protected blocks in one section) ─────────
        ClientVersion version = ClientVersion.V_1_21_4;
        Set<String> hiddenNames = Set.of("minecraft:chest");
        ChunkSanitizer.StateIdMapper mapper = new ChunkSanitizer.StateIdMapper() {
            @Override
            public String typeName(ClientVersion clientVersion, int stateId) {
                return stateId == 100 ? "minecraft:chest" : "minecraft:air";
            }

            @Override
            public int fillerStateId(ClientVersion clientVersion, Material fillerMaterial) {
                return 999;
            }
        };
        HiddenBlockIndex sanitizerIndex = new HiddenBlockIndex(null);
        for (int i = 0; i < 20; i++) {
            sanitizerIndex.register(1L, BlockPosUtil.encode(i, 8, 0));
        }
        HiddenBlockIndex.ChunkView sanitizerView = sanitizerIndex.chunkView(1L, 0, 0);
        FakeSection section = new FakeSection();
        Column column = new Column(0, 0, true, new BaseChunk[]{section}, new TileEntity[0]);
        int iterations = 100_000;
        start = System.nanoTime();
        for (int i = 0; i < iterations; i++) {
            for (int x = 0; x < 20; x++) {
                section.set(x, 8, 0, 100); // restore chest for the next iteration
            }
            ChunkSanitizer.sanitize(column, version, 0, sanitizerView, null, hiddenNames,
                    Material.STONE, mapper);
        }
        report("chunkSanitize.20blocks", (double) (System.nanoTime() - start) / iterations,
                "ns/op (checks=" + 20 + ")");

        // ── Bounded executor submit/dispatch throughput ─────────────────────
        try (BoundedTaskExecutor executor = new BoundedTaskExecutor(4, 4096, "bench", null)) {
            int tasks = 200_000;
            AtomicInteger counter = new AtomicInteger();
            start = System.nanoTime();
            for (int i = 0; i < tasks; i++) {
                if (!executor.submit(counter::incrementAndGet)) {
                    while (!executor.submit(counter::incrementAndGet)) {
                        Thread.onSpinWait();
                    }
                }
            }
            long deadline = System.currentTimeMillis() + 20_000;
            while (counter.get() < tasks && System.currentTimeMillis() < deadline) {
                Thread.onSpinWait();
            }
            long elapsed = System.nanoTime() - start;
            report("boundedExecutor.dispatch", (double) elapsed / tasks, "ns/task (executed="
                    + counter.get() + ", rejected=" + executor.rejected() + ")");
        }

        System.out.println("BENCH done");
    }
}
