package dev.audismp.aegishider.packet;

import com.github.retrooper.packetevents.protocol.nbt.NBTCompound;
import com.github.retrooper.packetevents.protocol.player.ClientVersion;
import com.github.retrooper.packetevents.protocol.world.chunk.BaseChunk;
import com.github.retrooper.packetevents.protocol.world.chunk.Column;
import com.github.retrooper.packetevents.protocol.world.chunk.TileEntity;
import com.github.retrooper.packetevents.protocol.world.chunk.impl.v_1_18.Chunk_v1_18;
import com.github.retrooper.packetevents.protocol.world.chunk.palette.DataPalette;
import dev.audismp.aegishider.index.HiddenBlockIndex;
import dev.audismp.aegishider.metrics.Metrics;
import dev.audismp.aegishider.util.BlockPosUtil;
import org.bukkit.Material;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ChunkSanitizerTest {

    private static final long WORLD = 1L;
    private static final ClientVersion VERSION = ClientVersion.V_1_21_4;
    private static final int CHEST_STATE = 100;
    private static final int ENDER_CHEST_STATE = 101;
    private static final int ENCHANTING_TABLE_STATE = 102;
    private static final int BEACON_STATE = 103;
    private static final int BOOKSHELF_STATE = 104;
    private static final int STONE_STATE = 1;
    private static final int FILLER_STATE = 999;
    private static final int AIR_STATE = 0;

    /** In-memory chunk section: index = (y << 8) | (z << 4) | x. */
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
            for (int state : states) {
                if (state != 0) {
                    return false;
                }
            }
            return true;
        }

        int peek(int x, int y, int z) {
            return states[(y << 8) | (z << 4) | x];
        }
    }

    private static final class FakeMapper implements ChunkSanitizer.StateIdMapper {
        final Map<Integer, String> names = new HashMap<>();
        final Map<Integer, String> tileEntityNames = new HashMap<>();

        FakeMapper() {
            names.put(CHEST_STATE, "minecraft:chest");
            names.put(ENDER_CHEST_STATE, "minecraft:ender_chest");
            names.put(ENCHANTING_TABLE_STATE, "minecraft:enchanting_table");
            names.put(BEACON_STATE, "minecraft:beacon");
            names.put(BOOKSHELF_STATE, "minecraft:bookshelf");
            names.put(STONE_STATE, "minecraft:stone");
            names.put(AIR_STATE, "minecraft:air");
            tileEntityNames.put(42, "chest");
            tileEntityNames.put(43, "sign");
            tileEntityNames.put(44, "ender_chest");
            tileEntityNames.put(45, "enchanting_table");
            tileEntityNames.put(46, "beacon");
        }

        @Override
        public String typeName(ClientVersion version, int stateId) {
            return names.get(stateId);
        }

        @Override
        public int fillerStateId(ClientVersion version, Material fillerMaterial) {
            return FILLER_STATE;
        }

        @Override
        public String tileEntityTypeName(ClientVersion version, int typeId) {
            return tileEntityNames.get(typeId);
        }
    }

    private static final Set<String> HIDDEN_NAMES = Set.of("chest");
    private static final Set<String> HIDDEN_TE_TYPES = Set.of("chest");
    private static final int UNMAPPED_STATE = 200;

    private HiddenBlockIndex.ChunkView viewFor(long... positions) {
        HiddenBlockIndex index = new HiddenBlockIndex(new Metrics());
        for (long position : positions) {
            index.register(WORLD, position);
        }
        return index.chunkView(WORLD, BlockPosUtil.decodeX(positions[0]) >> 4,
                BlockPosUtil.decodeZ(positions[0]) >> 4);
    }

    @Test
    void replacesProtectedBlockWithFiller() {
        FakeSection section = new FakeSection();
        section.set(5, 5, 5, CHEST_STATE);
        section.set(6, 5, 5, STONE_STATE);
        Column column = new Column(0, 0, true, new BaseChunk[]{section}, new TileEntity[0]);
        long protectedPos = BlockPosUtil.encode(5, 5, 5);

        ChunkSanitizer.Result result = ChunkSanitizer.sanitize(column, VERSION, 0,
                viewFor(protectedPos), null, HIDDEN_NAMES, Material.STONE, new FakeMapper());

        assertTrue(result.rewritten());
        assertEquals(1, result.changedBlocks());
        assertEquals(FILLER_STATE, section.peek(5, 5, 5), "chest replaced by filler");
        assertEquals(STONE_STATE, section.peek(6, 5, 5), "unprotected block untouched");
    }

    @Test
    void staleIndexEntryWithAirDoesNotBreakChunk() {
        FakeSection section = new FakeSection(); // everything air
        Column column = new Column(0, 0, true, new BaseChunk[]{section}, new TileEntity[0]);
        ChunkSanitizer.Result result = ChunkSanitizer.sanitize(column, VERSION, 0,
                viewFor(BlockPosUtil.encode(1, 1, 1)), null, HIDDEN_NAMES, Material.STONE,
                new FakeMapper());
        assertFalse(result.rewritten());
        assertEquals(0, result.changedBlocks());
    }

    @Test
    void nonProtectedMaterialAtIndexedPositionIsNotReplaced() {
        FakeSection section = new FakeSection();
        section.set(2, 2, 2, STONE_STATE); // index says hidden, world says stone
        Column column = new Column(0, 0, true, new BaseChunk[]{section}, new TileEntity[0]);
        ChunkSanitizer.Result result = ChunkSanitizer.sanitize(column, VERSION, 0,
                viewFor(BlockPosUtil.encode(2, 2, 2)), null, HIDDEN_NAMES, Material.STONE,
                new FakeMapper());
        assertFalse(result.rewritten());
        assertEquals(STONE_STATE, section.peek(2, 2, 2));
    }

    @Test
    void blockEntityDataForProtectedPositionIsRemoved() {
        FakeSection section = new FakeSection();
        section.set(9, 3, 9, CHEST_STATE);
        // packed XZ: localX = 9, localZ = 9 -> (9 << 4) | 9 = 153
        TileEntity protectedTile = new TileEntity((byte) ((9 << 4) | 9), (short) 3, 0,
                new NBTCompound());
        TileEntity otherTile = new TileEntity((byte) ((1 << 4) | 1), (short) 3, 0,
                new NBTCompound());
        Column column = new Column(0, 0, true, new BaseChunk[]{section},
                new TileEntity[]{protectedTile, otherTile});

        ChunkSanitizer.Result result = ChunkSanitizer.sanitize(column, VERSION, 0,
                viewFor(BlockPosUtil.encode(9, 3, 9)), null, HIDDEN_NAMES, Material.STONE,
                new FakeMapper());

        assertTrue(result.rewritten());
        assertNotNull(result.tileEntities());
        assertEquals(1, result.tileEntities().length);
        int packed = result.tileEntities()[0].getPackedByte() & 0xFF;
        assertEquals(1, (packed >> 4) & 0xF);
        assertEquals(1, packed & 0xF);
    }

    @Test
    void previousWorldViewIsAlsoSanitized() {
        FakeSection section = new FakeSection();
        section.set(4, 4, 4, CHEST_STATE);
        Column column = new Column(0, 0, true, new BaseChunk[]{section}, new TileEntity[0]);
        long pos = BlockPosUtil.encode(4, 4, 4);
        // Current view does not contain the pos, previous world view does (world transition).
        HiddenBlockIndex index = new HiddenBlockIndex(new Metrics());
        index.register(WORLD, pos);
        HiddenBlockIndex.ChunkView previousView = index.chunkView(WORLD, 0, 0);

        ChunkSanitizer.Result result = ChunkSanitizer.sanitize(column, VERSION, 0,
                null, previousView, HIDDEN_NAMES, Material.STONE, new FakeMapper());
        assertTrue(result.rewritten());
        assertEquals(FILLER_STATE, section.peek(4, 4, 4));
    }

    @Test
    void unchangedChunkIsNotRewritten() {
        FakeSection section = new FakeSection();
        section.set(0, 0, 0, STONE_STATE);
        Column column = new Column(0, 0, true, new BaseChunk[]{section}, new TileEntity[0]);
        ChunkSanitizer.Result result = ChunkSanitizer.sanitize(column, VERSION, 0,
                null, null, HIDDEN_NAMES, Material.STONE, new FakeMapper());
        assertFalse(result.rewritten());
        assertNull(result.tileEntities());
    }

    @Test
    void tileEntityScanHidesBlockEvenWithoutIndex() {
        // Simulates a container placed/changed by a non-Bukkit path: the index is empty,
        // but the chunk's own block entity still proves the chest exists.
        FakeSection section = new FakeSection();
        section.set(7, 2, 7, CHEST_STATE);
        TileEntity chestTile = new TileEntity((byte) ((7 << 4) | 7), (short) 2, 0,
                new NBTCompound());
        Column column = new Column(0, 0, true, new BaseChunk[]{section},
                new TileEntity[]{chestTile});

        ChunkSanitizer.Result result = ChunkSanitizer.sanitize(column, VERSION, 0,
                null, null, HIDDEN_NAMES, Material.STONE, new FakeMapper(), true);

        assertTrue(result.rewritten());
        assertFalse(result.tileEntities() != null && result.tileEntities().length > 0);
        assertTrue(result.hasDetectedPositions());
        assertEquals(1, result.detectedPositions().length);
        assertEquals(BlockPosUtil.encode(7, 2, 7), result.detectedPositions()[0]);
        assertEquals(FILLER_STATE, section.peek(7, 2, 7));
    }

    @Test
    void tileEntityScanIgnoresBlockEntitiesOfNonProtectedBlocks() {
        FakeSection section = new FakeSection();
        section.set(1, 1, 1, STONE_STATE);
        TileEntity otherTile = new TileEntity((byte) ((1 << 4) | 1), (short) 1, 0,
                new NBTCompound());
        Column column = new Column(0, 0, true, new BaseChunk[]{section},
                new TileEntity[]{otherTile});

        ChunkSanitizer.Result result = ChunkSanitizer.sanitize(column, VERSION, 0,
                null, null, HIDDEN_NAMES, Material.STONE, new FakeMapper(), true);
        assertFalse(result.rewritten());
        assertFalse(result.hasDetectedPositions());
        assertEquals(STONE_STATE, section.peek(1, 1, 1));
    }

    @Test
    void tileEntityScanReportsKnownIndexedPositionOnlyOnce() {
        FakeSection section = new FakeSection();
        section.set(5, 5, 5, CHEST_STATE);
        TileEntity chestTile = new TileEntity((byte) ((5 << 4) | 5), (short) 5, 0,
                new NBTCompound());
        Column column = new Column(0, 0, true, new BaseChunk[]{section},
                new TileEntity[]{chestTile});
        long pos = BlockPosUtil.encode(5, 5, 5);

        ChunkSanitizer.Result result = ChunkSanitizer.sanitize(column, VERSION, 0,
                viewFor(pos), null, HIDDEN_NAMES, Material.STONE, new FakeMapper(), true);
        assertTrue(result.rewritten());
        assertFalse(result.hasDetectedPositions(), "indexed positions need no detection bridge");
        assertTrue(result.tileEntities() == null || result.tileEntities().length == 0,
                "block entity of an indexed protected block must be stripped");
    }

    @Test
    void hiddenTileEntityTypeStripsEntityWhenStateIdIsUnresolvable() {
        // The block-state palette cannot be resolved (e.g. mapping failure), but the
        // block-entity registry id still identifies the chest: it must be stripped.
        FakeSection section = new FakeSection();
        section.set(3, 4, 3, UNMAPPED_STATE);
        TileEntity chestTile = new TileEntity((byte) ((3 << 4) | 3), (short) 4, 42,
                new NBTCompound());
        Column column = new Column(0, 0, true, new BaseChunk[]{section},
                new TileEntity[]{chestTile});

        ChunkSanitizer.Result result = ChunkSanitizer.sanitize(column, VERSION, 0,
                null, null, HIDDEN_NAMES, Material.STONE, null, new FakeMapper(), true,
                HIDDEN_TE_TYPES);

        assertTrue(result.rewritten());
        assertEquals(FILLER_STATE, section.peek(3, 4, 3),
                "unresolvable state at a hidden block entity must be replaced via TE type");
        assertFalse(result.tileEntities() != null && result.tileEntities().length > 0);
        assertTrue(result.hasDetectedPositions());
        assertEquals(BlockPosUtil.encode(3, 4, 3), result.detectedPositions()[0]);
    }

    /** Avoids PacketEvents' state registry (unavailable in the pure-unit-test JVM). */
    private static final class TestChunk extends Chunk_v1_18 {
        TestChunk() {
            super(VERSION, 0, 0, DataPalette.createForChunk(), DataPalette.createForBiome());
            setBlockCount(4096);
        }

        @Override
        public void set(int x, int y, int z, int stateId) {
            getChunkData().set(x, y, z, stateId);
        }
    }

    private static Chunk_v1_18 realSection() {
        return new TestChunk();
    }

    @Test
    void stateOnlyScanUsesPalettePrefilterAndCountsOnlyMatchingSections() {
        Chunk_v1_18 stoneOnly = realSection();
        for (int y = 0; y < 16; y++) {
            for (int x = 0; x < 16; x++) {
                for (int z = 0; z < 16; z++) {
                    stoneOnly.getChunkData().set(x, y, z, STONE_STATE);
                }
            }
        }
        Column noMatch = new Column(0, 0, true, new BaseChunk[]{stoneOnly}, new TileEntity[0]);
        ChunkSanitizer.Result skipped = ChunkSanitizer.sanitize(noMatch, VERSION, 0,
                null, null, Set.of(), Material.STONE, null, new FakeMapper(), true,
                Set.of(), Set.of("bookshelf"));

        assertFalse(skipped.rewritten());
        assertEquals(1, skipped.stateScan().sectionsVisited());
        assertEquals(1, skipped.stateScan().sectionsPrefiltered());
        assertEquals(0, skipped.stateScan().sectionsScanned());
        assertEquals(0, skipped.stateScan().blocksRead());
        assertTrue(skipped.stateScan().skippedAllSections());

        Chunk_v1_18 withBookshelf = realSection();
        for (int y = 0; y < 16; y++) {
            for (int x = 0; x < 16; x++) {
                for (int z = 0; z < 16; z++) {
                    withBookshelf.getChunkData().set(x, y, z, STONE_STATE);
                }
            }
        }
        withBookshelf.getChunkData().set(4, 5, 6, BOOKSHELF_STATE);
        Column match = new Column(0, 0, true, new BaseChunk[]{withBookshelf}, new TileEntity[0]);
        ChunkSanitizer.Result scanned = ChunkSanitizer.sanitize(match, VERSION, 0,
                null, null, Set.of(), Material.STONE, null, new FakeMapper(), true,
                Set.of(), Set.of("bookshelf"));

        assertTrue(scanned.rewritten());
        assertEquals(1, scanned.stateScan().sectionsVisited());
        assertEquals(0, scanned.stateScan().sectionsPrefiltered());
        assertEquals(1, scanned.stateScan().sectionsScanned());
        assertEquals(4096, scanned.stateScan().blocksRead());
        assertEquals(FILLER_STATE, withBookshelf.getBlockId(4, 5, 6));
    }

    @Test
    void stateOnlyPositionIsStillSanitizedWhenOnlyStateNamesAreProvided() {
        FakeSection section = new FakeSection();
        section.set(6, 4, 6, BOOKSHELF_STATE);
        Column column = new Column(0, 0, true, new BaseChunk[]{section}, new TileEntity[0]);
        long pos = BlockPosUtil.encode(6, 4, 6);

        // Simulate a caller that has the position indexed but forgot to put the
        // material in hiddenNames; the state scan must not skip it just because the
        // index knows it, or the chunk would leak a bookshelf.
        ChunkSanitizer.Result result = ChunkSanitizer.sanitize(column, VERSION, 0,
                viewFor(pos), null, Set.of(), Material.STONE, null, new FakeMapper(), true,
                Set.of(), Set.of("bookshelf"));

        assertTrue(result.rewritten());
        assertEquals(FILLER_STATE, section.peek(6, 4, 6));
    }

    @Test
    void stateOnlyBookshelfIsHiddenWithoutABlockEntity() {
        FakeSection section = new FakeSection();
        section.set(4, 5, 6, BOOKSHELF_STATE);
        Column column = new Column(0, 0, true, new BaseChunk[]{section}, new TileEntity[0]);

        ChunkSanitizer.Result result = ChunkSanitizer.sanitize(column, VERSION, 0,
                null, null, Set.of("bookshelf"), Material.STONE, null, new FakeMapper(), true,
                Set.of(), Set.of("bookshelf"));

        assertTrue(result.rewritten());
        assertEquals(FILLER_STATE, section.peek(4, 5, 6),
                "plain bookshelf has no block entity, so its state must be replaced by the state scan");
        assertTrue(result.hasDetectedPositions());
        assertEquals(BlockPosUtil.encode(4, 5, 6), result.detectedPositions()[0]);
    }

    @Test
    void beaconBeamSourceIsRemovedWithTheBeaconBlockEntity() {
        FakeSection section = new FakeSection();
        section.set(3, 3, 3, BEACON_STATE);
        TileEntity beaconTile = new TileEntity((byte) ((3 << 4) | 3), (short) 3, 46,
                new NBTCompound());
        Column column = new Column(0, 0, true, new BaseChunk[]{section},
                new TileEntity[]{beaconTile});

        ChunkSanitizer.Result result = ChunkSanitizer.sanitize(column, VERSION, 0,
                null, null, Set.of("beacon"), Material.STONE, null, new FakeMapper(), true,
                Set.of("beacon"));

        assertTrue(result.rewritten());
        assertEquals(FILLER_STATE, section.peek(3, 3, 3));
        assertTrue(result.tileEntities() == null || result.tileEntities().length == 0,
                "beacon block entity drives the client-side beam; it must not reach the client");
    }

    @Test
    void baseMarkerStatesAndBlockEntitiesAreAllRemoved() {
        FakeSection section = new FakeSection();
        section.set(1, 1, 1, ENDER_CHEST_STATE);
        section.set(2, 2, 2, ENCHANTING_TABLE_STATE);
        section.set(3, 3, 3, BEACON_STATE);
        TileEntity[] tiles = new TileEntity[]{
                new TileEntity((byte) ((1 << 4) | 1), (short) 1, 44, new NBTCompound()),
                new TileEntity((byte) ((2 << 4) | 2), (short) 2, 45, new NBTCompound()),
                new TileEntity((byte) ((3 << 4) | 3), (short) 3, 46, new NBTCompound())
        };
        Column column = new Column(0, 0, true, new BaseChunk[]{section}, tiles);

        ChunkSanitizer.Result result = ChunkSanitizer.sanitize(column, VERSION, 0,
                null, null, Set.of("ender_chest", "enchanting_table", "beacon"),
                Material.STONE, null, new FakeMapper(), true,
                Set.of("ender_chest", "enchanting_table", "beacon"));

        assertTrue(result.rewritten());
        assertEquals(FILLER_STATE, section.peek(1, 1, 1));
        assertEquals(FILLER_STATE, section.peek(2, 2, 2));
        assertEquals(FILLER_STATE, section.peek(3, 3, 3));
        assertNotNull(result.tileEntities());
        assertEquals(0, result.tileEntities().length,
                "no ender chest, enchanting table or beacon block entity may reach the client");
        assertTrue(result.hasDetectedPositions());
    }

    @Test
    void yShieldFillsWholeUndergroundVolumeAndPreservesSurfaceLayers() {
        FakeSection lower = new FakeSection();
        lower.set(5, 5, 5, AIR_STATE);
        lower.set(6, 6, 6, CHEST_STATE);
        FakeSection upper = new FakeSection();
        upper.set(1, 0, 1, STONE_STATE);   // y=16, below the line
        upper.set(2, 3, 2, AIR_STATE);     // y=19, below the line
        upper.set(3, 4, 3, BOOKSHELF_STATE); // y=20, exactly at the line
        upper.set(4, 15, 4, STONE_STATE);  // y=31, surface terrain
        Column column = new Column(0, 0, true, new BaseChunk[]{lower, upper},
                new TileEntity[0]);

        FakeSection filler = new FakeSection();
        for (int y = 0; y < 16; y++) {
            for (int x = 0; x < 16; x++) {
                for (int z = 0; z < 16; z++) {
                    filler.set(x, y, z, FILLER_STATE);
                }
            }
        }

        int masked = ChunkSanitizer.maskBelowY(column, 0, 20, FILLER_STATE, filler);

        assertEquals(2, masked);
        BaseChunk[] sections = column.getChunks();
        assertNotNull(sections[0]);
        assertEquals(FILLER_STATE, ((FakeSection) sections[0]).peek(5, 5, 5),
                "air inside a room must become stone, not stay visible");
        assertEquals(FILLER_STATE, upper.peek(1, 0, 1));
        assertEquals(FILLER_STATE, upper.peek(2, 3, 2));
        assertEquals(BOOKSHELF_STATE, upper.peek(3, 4, 3),
                "a block exactly at hide-below-y is not below the line");
        assertEquals(STONE_STATE, upper.peek(4, 15, 4),
                "surface terrain in the straddling section is preserved");
    }

    @Test
    void nonHiddenTileEntityTypeIsPreserved() {
        FakeSection section = new FakeSection();
        section.set(1, 1, 1, STONE_STATE);
        TileEntity signTile = new TileEntity((byte) ((1 << 4) | 1), (short) 1, 43,
                new NBTCompound());
        Column column = new Column(0, 0, true, new BaseChunk[]{section},
                new TileEntity[]{signTile});

        ChunkSanitizer.Result result = ChunkSanitizer.sanitize(column, VERSION, 0,
                null, null, HIDDEN_NAMES, Material.STONE, null, new FakeMapper(), true,
                HIDDEN_TE_TYPES);

        assertFalse(result.rewritten(), "signs are not protected and must pass through");
        assertEquals(STONE_STATE, section.peek(1, 1, 1));
        assertFalse(result.hasDetectedPositions());
    }
}
