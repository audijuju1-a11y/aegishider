package dev.audismp.aegishider.util;

/**
 * Encodes Minecraft block and chunk positions into primitive longs.
 * Zero allocation in hot paths.
 *
 * <p>Block position layout (world-agnostic, same as the legacy Aegishider format):
 * <pre>
 *   [63..38] X  26 bits signed (-33_554_432 .. 33_554_431)
 *   [37..26] Y  12 bits signed (      -2048 .. 2_047)
 *   [25.. 0] Z  26 bits signed (-33_554_432 .. 33_554_431)
 * </pre>
 *
 * <p>Chunk key layout (world-aware, collision free for interned world ids):
 * <pre>
 *   [63..44] worldId 20 bits (1 .. 1_048_575; 0 means unknown)
 *   [43..22] chunkX  22 bits signed (-2_097_152 .. 2_097_151)
 *   [21.. 0] chunkZ  22 bits signed (-2_097_152 .. 2_097_151)
 * </pre>
 *
 * <p>The 20-bit world id is assigned sequentially by {@link dev.audismp.aegishider.core.WorldKeys}
 * for the lifetime of the JVM, therefore two different worlds can never share a chunk
 * key. (The previous implementation used {@code worldName.hashCode()} truncated to 20
 * bits, which could collide and mixed world data.)
 */
public final class BlockPosUtil {

    private BlockPosUtil() {
    }

    public static final int CHUNK_MIN = -2_097_152;
    public static final int CHUNK_MAX = 2_097_151;

    public static long encode(int x, int y, int z) {
        return ((long) (x & 0x3FF_FFFF) << 38)
                | ((long) (y & 0xFFF) << 26)
                | (long) (z & 0x3FF_FFFF);
    }

    public static int decodeX(long pos) {
        int raw = (int) ((pos >>> 38) & 0x3FF_FFFF);
        return (raw & 0x200_0000) != 0 ? raw | 0xFC00_0000 : raw;
    }

    public static int decodeY(long pos) {
        int raw = (int) ((pos >>> 26) & 0xFFF);
        return (raw & 0x800) != 0 ? raw | 0xFFFF_F000 : raw;
    }

    public static int decodeZ(long pos) {
        int raw = (int) (pos & 0x3FF_FFFF);
        return (raw & 0x200_0000) != 0 ? raw | 0xFC00_0000 : raw;
    }

    public static long chunkKey(long worldId, int chunkX, int chunkZ) {
        return ((worldId & 0xF_FFFFL) << 44)
                | (((long) chunkX & 0x3F_FFFFL) << 22)
                | ((long) chunkZ & 0x3F_FFFFL);
    }

    public static long worldIdOfChunkKey(long chunkKey) {
        return (chunkKey >>> 44) & 0xF_FFFFL;
    }

    public static int chunkXOf(long chunkKey) {
        int raw = (int) ((chunkKey >>> 22) & 0x3F_FFFFL);
        return (raw & 0x20_0000) != 0 ? raw | 0xFFC0_0000 : raw;
    }

    public static int chunkZOf(long chunkKey) {
        int raw = (int) (chunkKey & 0x3F_FFFFL);
        return (raw & 0x20_0000) != 0 ? raw | 0xFFC0_0000 : raw;
    }

    /**
     * Chunk key for a world-agnostic block position. Only use when the world id is
     * already known and part of the enclosing map key; prefer
     * {@link #chunkKeyOfBlock(long, long)} for anything that crosses worlds.
     */
    public static long chunkKeyOfBlock(int x, int z) {
        return chunkKey(0, x >> 4, z >> 4);
    }

    public static long chunkKeyOfBlock(long worldId, long blockPos) {
        return chunkKey(worldId, decodeX(blockPos) >> 4, decodeZ(blockPos) >> 4);
    }

    /** Packs two 32-bit ints (e.g. chunk coordinates) into a long for map keys. */
    public static long pack(int a, int b) {
        return ((long) a << 32) | (b & 0xFFFF_FFFFL);
    }

    public static int unpackA(long packed) {
        return (int) (packed >> 32);
    }

    public static int unpackB(long packed) {
        return (int) packed;
    }
}
