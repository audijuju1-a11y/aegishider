package dev.audismp.aegishider.config;

import dev.audismp.aegishider.util.MaterialSets;
import org.bukkit.Material;
import org.bukkit.configuration.file.YamlConfiguration;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ConfigLoaderTest {

    private static AegishiderConfig load(String yaml, @TempDir Path tempDir) throws IOException {
        Path file = tempDir.resolve("config.yml");
        Files.writeString(file, yaml);
        YamlConfiguration configuration = YamlConfiguration.loadConfiguration(file.toFile());
        return ConfigLoader.load(configuration, 1L);
    }

    @Test
    void emptyConfigUsesSecureBuiltinDefaults() {
        AegishiderConfig config = ConfigLoader.load(new YamlConfiguration(), 1L);
        WorldSettings defaults = config.world("any_world");
        assertTrue(defaults.isEnabled());
        assertTrue(defaults.blocksEnabled());
        assertTrue(defaults.hiddenMaterials().contains(Material.CHEST));
        assertTrue(defaults.hiddenMaterials().contains(Material.SPAWNER));
        assertTrue(defaults.hiddenEntityTypes().contains(org.bukkit.entity.EntityType.ITEM));
        assertTrue(defaults.itemProtection().protectAllLiving());
        assertTrue(defaults.itemProtection().isHiddenType(org.bukkit.entity.EntityType.COW));
        assertTrue(defaults.entityHeightShield().enabled());
        assertEquals(16.0, defaults.entityHeightShield().maxVerticalDistance(), 1e-9);
        assertEquals(50.0, defaults.entityHeightShield().undergroundY(), 1e-9);
        assertEquals(12.0, defaults.entityHeightShield().bandMargin(), 1e-9);
        assertEquals(360.0, defaults.blockProtection().fovDegrees(), 1e-9);
        assertEquals(360.0, defaults.itemProtection().fovDegrees(), 1e-9);
        assertTrue(config.failClosed());
        assertTrue(config.raycastBudgetPerTick() > 0);
    }

    @Test
    void blocksAndItemsCanBeDisabledPerWorld(@TempDir Path tempDir) throws IOException {
        AegishiderConfig config = load("""
                worlds:
                  default:
                    enabled: true
                    block-protection:
                      enabled: false
                    item-protection:
                      enabled: false
                  world:
                    enabled: false
                """, tempDir);
        WorldSettings defaultWorld = config.world("other");
        assertFalse(defaultWorld.blocksEnabled());
        assertFalse(defaultWorld.itemsEnabled());
        assertFalse(config.world("world").isEnabled());
    }

    @Test
    void invalidValuesAreClampedWithWarnings(@TempDir Path tempDir) throws IOException {
        AegishiderConfig config = load("""
                security:
                  fail-closed: false
                  main-thread-budget-ms: 999
                  raycast-budget-per-tick: 100000
                worlds:
                  default:
                    block-protection:
                      reveal:
                        max-distance: 0.1
                        fov-degrees: 500
                """, tempDir);
        assertTrue(config.mainThreadBudgetMs() <= 20.0);
        assertTrue(config.raycastBudgetPerTick() <= 5000);
        assertFalse(config.warnings().isEmpty());
        assertTrue(config.warnings().stream().anyMatch(w -> w.contains("fail-closed")));
        assertTrue(config.warnings().stream().anyMatch(w -> w.contains("max-distance")));
    }

    @Test
    void unsupportedHiddenBlocksAreRejected(@TempDir Path tempDir) throws IOException {
        AegishiderConfig config = load("""
                worlds:
                  default:
                    block-protection:
                      hidden-blocks: [CHEST, DIAMOND_ORE, MADNESS]
                """, tempDir);
        WorldSettings settings = config.world("test");
        assertTrue(settings.hiddenMaterials().contains(Material.CHEST));
        assertFalse(settings.hiddenMaterials().contains(Material.DIAMOND_ORE));
        assertTrue(config.warnings().stream().anyMatch(w -> w.contains("DIAMOND_ORE")));
    }

    @Test
    void entityHeightShieldIsConfigurable(@TempDir Path tempDir) throws IOException {
        AegishiderConfig config = load("""
                worlds:
                  default:
                    entity-height-shield:
                      enabled: true
                      max-vertical-distance: 24.0
                """, tempDir);
        WorldSettings settings = config.world("test");
        assertTrue(settings.entityHeightShield().enabled());
        assertEquals(24.0, settings.entityHeightShield().maxVerticalDistance(), 1e-9);
        assertEquals(50.0, settings.entityHeightShield().undergroundY(), 1e-9);
        assertEquals(12.0, settings.entityHeightShield().bandMargin(), 1e-9);
        // A ravine/mineshaft pair at 70/40 is inside the dead band and stays visible.
        assertFalse(settings.entityHeightShield().separates(70.0, 40.0));
        assertTrue(settings.entityHeightShield().separates(70.0, 30.0));
        assertFalse(settings.entityHeightShield().separates(70.0, 60.0));
        // Both parties above ground: a mountain, tower or elytra flight stays visible.
        assertFalse(settings.entityHeightShield().separates(90.0, 70.0));
        // A deep base is still separated from the surface.
        assertTrue(settings.entityHeightShield().separates(70.0, -50.0));
    }

    @Test
    void entityHeightShieldUndergroundYIsConfigurable(@TempDir Path tempDir) throws IOException {
        AegishiderConfig config = load("""
                worlds:
                  default:
                    entity-height-shield:
                      underground-y: 64.0
                """, tempDir);
        WorldSettings settings = config.world("test");
        assertEquals(64.0, settings.entityHeightShield().undergroundY(), 1e-9);
        assertFalse(settings.entityHeightShield().separates(80.0, 60.0));
        assertTrue(settings.entityHeightShield().separates(100.0, 50.0));
        assertFalse(settings.entityHeightShield().separates(100.0, 80.0));
    }

    @Test
    void entityHeightShieldBandMarginIsConfigurable(@TempDir Path tempDir) throws IOException {
        AegishiderConfig config = load("""
                worlds:
                  default:
                    entity-height-shield:
                      band-margin: 4.0
                """, tempDir);
        WorldSettings settings = config.world("test");
        assertEquals(4.0, settings.entityHeightShield().bandMargin(), 1e-9);
        assertTrue(settings.entityHeightShield().separates(70.0, 40.0));
    }

    @Test
    void entityHeightShieldOutOfRangeIsClamped(@TempDir Path tempDir) throws IOException {
        AegishiderConfig config = load("""
                worlds:
                  default:
                    entity-height-shield:
                      max-vertical-distance: 1000
                """, tempDir);
        WorldSettings settings = config.world("test");
        assertEquals(64.0, settings.entityHeightShield().maxVerticalDistance(), 1e-9);
        assertTrue(config.warnings().stream().anyMatch(w -> w.contains("max-vertical-distance")));
    }

    @Test
    void allLivingEntitiesCanBeProtected(@TempDir Path tempDir) throws IOException {
        AegishiderConfig config = load("""
                worlds:
                  default:
                    item-protection:
                      hidden-entity-types: [ITEM]
                      hide-all-living-entities: true
                """, tempDir);
        WorldSettings settings = config.world("test");
        assertTrue(settings.itemsEnabled());
        assertTrue(settings.itemProtection().isHiddenType(org.bukkit.entity.EntityType.COW));
        assertTrue(settings.itemProtection().isHiddenType(org.bukkit.entity.EntityType.ZOMBIE));
        assertFalse(settings.itemProtection().isHiddenType(org.bukkit.entity.EntityType.PLAYER));
        assertFalse(settings.itemProtection().isHiddenType(org.bukkit.entity.EntityType.MINECART));
    }

    @Test
    void playerEntityHidingIsRejected(@TempDir Path tempDir) throws IOException {
        AegishiderConfig config = load("""
                worlds:
                  default:
                    item-protection:
                      hidden-entity-types: [ITEM, PLAYER]
                """, tempDir);
        WorldSettings settings = config.world("test");
        assertTrue(settings.hiddenEntityTypes().contains(org.bukkit.entity.EntityType.ITEM));
        assertFalse(settings.hiddenEntityTypes().contains(org.bukkit.entity.EntityType.PLAYER));
        assertTrue(config.warnings().stream().anyMatch(w -> w.contains("PLAYER")));
    }

    @Test
    void legacyHiddenBlocksFormatIsMigrated(@TempDir Path tempDir) throws IOException {
        AegishiderConfig config = load("""
                worlds:
                  world:
                    enabled: true
                    mode: SMART
                    hidden-blocks: [CHEST, BARREL]
                """, tempDir);
        WorldSettings settings = config.world("world");
        assertTrue(settings.blocksEnabled());
        assertTrue(settings.hiddenMaterials().contains(Material.CHEST));
        assertTrue(settings.hiddenMaterials().contains(Material.BARREL));
        assertTrue(config.warnings().stream().anyMatch(w -> w.contains("legacy")));
    }

    @Test
    void separateWorldSectionOverridesDefault(@TempDir Path tempDir) throws IOException {
        AegishiderConfig config = load("""
                worlds:
                  default:
                    block-protection:
                      reveal:
                        max-distance: 8.0
                  creative:
                    block-protection:
                      enabled: false
                """, tempDir);
        assertEquals(8.0, config.world("survival").blockProtection().revealDistance(), 1e-9);
        assertFalse(config.world("creative").blocksEnabled());
    }

    @Test
    void packetGatewayMinimumVersionIsParsed(@TempDir Path tempDir) throws IOException {
        AegishiderConfig config = load("""
                security:
                  packet-gateway:
                    minimum-version: "2.14.0"
                """, tempDir);
        assertEquals("2.14.0", config.packetGateway().minimumVersion());
    }

    @Test
    void fovAndRevealDefaultsAreSane() {
        AegishiderConfig config = ConfigLoader.load(new YamlConfiguration(), 1L);
        WorldSettings settings = config.world("world");
        assertNotNull(settings.blockProtection());
        assertTrue(settings.blockProtection().fovDegrees() > 0
                && settings.blockProtection().fovDegrees() <= 360);
        assertEquals(24.0, settings.blockProtection().revealDistance(), 1e-9);
        assertEquals(24.0, settings.itemProtection().revealDistance(), 1e-9);
        assertEquals(360.0, settings.blockProtection().fovDegrees(), 1e-9);
        assertEquals(360.0, settings.itemProtection().fovDegrees(), 1e-9);
        assertEquals(360.0, settings.playerProtection().fovDegrees(), 1e-9);
        assertTrue(settings.blockProtection().fovCosHalf() < 0.0,
                "360 degrees must be the disabled sentinel, not a 90-degree half-cone");
    }

    @Test
    void playerDistanceLayerIsOptIn(@TempDir Path tempDir) throws IOException {
        AegishiderConfig config = load("""
                worlds:
                  default:
                    player-protection:
                      enabled: true
                      distance-hiding: true
                """, tempDir);
        WorldSettings settings = config.world("test");
        assertTrue(settings.playerProtection().enabled());
        assertTrue(settings.playerProtection().distanceHiding());
    }

    @Test
    void analyticsDefaultOff() {
        AegishiderConfig config = ConfigLoader.load(new YamlConfiguration(), 1L);
        assertFalse(config.mining().enabled());
        assertFalse(config.raid().enabled());
        assertFalse(config.debug().logBlockedPackets());
    }

    @Test
    void tileEntityFillerIsReplacedWithStone(@TempDir Path tempDir) throws IOException {
        AegishiderConfig config = load("""
                worlds:
                  default:
                    block-protection:
                      hidden-blocks: [CHEST]
                      replace-with: OAK_SIGN
                """, tempDir);
        WorldSettings settings = config.world("test");
        assertEquals(Material.STONE, settings.blockProtection().replaceWith());
        assertTrue(config.warnings().stream().anyMatch(w -> w.contains("block entity")));
    }

    @Test
    void yShieldTileEntityFillerIsReplacedWithStone(@TempDir Path tempDir) throws IOException {
        AegishiderConfig config = load("""
                worlds:
                  default:
                    y-shield:
                      enabled: true
                      filler: CHEST
                """, tempDir);
        WorldSettings settings = config.world("test");
        assertEquals(Material.STONE, settings.yShield().filler());
        assertTrue(config.warnings().stream().anyMatch(w -> w.contains("y-shield.filler")));
    }

    @Test
    void shippedConfigKeysAreLiveAndSafeDefaults() throws IOException {
        try (var stream = getClass().getResourceAsStream("/config.yml")) {
            assertNotNull(stream, "bundled config.yml is missing");
            YamlConfiguration configuration = YamlConfiguration.loadConfiguration(
                    new InputStreamReader(stream, StandardCharsets.UTF_8));
            AegishiderConfig config = ConfigLoader.load(configuration, 1L);
            assertEquals(180, config.raycastBudgetPerTick());
            WorldSettings settings = config.world("world");
            assertTrue(settings.playerProtection().enabled());
            assertFalse(settings.playerProtection().distanceHiding());
            assertTrue(settings.itemProtection().protectAllLiving());
            assertTrue(settings.itemProtection().isHiddenType(org.bukkit.entity.EntityType.COW));
            assertTrue(settings.entityHeightShield().enabled());
            assertEquals(16.0, settings.entityHeightShield().maxVerticalDistance(), 1e-9);
            assertEquals(50.0, settings.entityHeightShield().undergroundY(), 1e-9);
            assertFalse(settings.yShield().enabled());
            assertFalse(settings.tunnelShield().enabled());
            assertTrue(settings.hiddenMaterials().contains(Material.CRAFTER));
            assertTrue(settings.hiddenMaterials().contains(Material.DECORATED_POT));
            assertTrue(settings.hiddenMaterials().contains(Material.CHISELED_BOOKSHELF));
            assertFalse(settings.hiddenMaterials().contains(Material.BOOKSHELF));
            assertTrue(settings.hiddenMaterials().contains(Material.LECTERN));
            assertTrue(settings.hiddenMaterials().contains(Material.ENDER_CHEST));
            assertTrue(settings.hiddenMaterials().contains(Material.ENCHANTING_TABLE));
            assertFalse(settings.hiddenMaterials().contains(Material.BEACON));
            assertFalse(settings.hiddenMaterials().contains(Material.JUKEBOX));
            assertFalse(settings.hiddenMaterials().contains(Material.NOTE_BLOCK));
            assertTrue(MaterialSets.isStateOnlyHiddenMaterial(Material.BOOKSHELF),
                    "plain bookshelf uses the block-state scan path, not the block-entity path");
        }
    }

    @Test
    void warningsListIsImmutable() {
        AegishiderConfig config = ConfigLoader.load(new YamlConfiguration(), 1L);
        List<String> warnings = config.warnings();
        try {
            warnings.add("x");
            throw new AssertionError("warnings list should be immutable");
        } catch (UnsupportedOperationException expected) {
            // ok
        }
    }
}
