package dev.audismp.aegishider.item;

import dev.audismp.aegishider.config.AegishiderConfig;
import dev.audismp.aegishider.config.ConfigLoader;
import dev.audismp.aegishider.config.WorldSettings;
import org.bukkit.Material;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.EntityType;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MobVisibilityPolicyTest {

    private static final List<EntityType> MONSTERS = List.of(
            EntityType.ZOMBIE,
            EntityType.SKELETON,
            EntityType.CREEPER,
            EntityType.WITHER);

    private static final List<EntityType> ANIMALS = List.of(
            EntityType.COW,
            EntityType.PIG,
            EntityType.CHICKEN,
            EntityType.SHEEP,
            EntityType.HORSE,
            EntityType.WOLF,
            EntityType.VILLAGER,
            EntityType.IRON_GOLEM,
            EntityType.ALLAY);

    @Test
    void builtinDefaultsHideMonstersAndAnimalsWithoutWorldsSection() {
        AegishiderConfig config = ConfigLoader.load(new YamlConfiguration(), 1L);
        WorldSettings.ItemProtection policy = config.world("world").itemProtection();

        assertTrue(policy.protectAllLiving(),
                "every living type is protected by the built-in default");
        for (EntityType type : MONSTERS) {
            assertTrue(policy.isHiddenType(type), type + " (monster) must be hidden");
        }
        for (EntityType type : ANIMALS) {
            assertTrue(policy.isHiddenType(type), type + " (animal/village) must be hidden");
        }
        assertTrue(policy.isHiddenType(EntityType.ITEM), "dropped items stay protected");
        assertFalse(policy.isHiddenType(EntityType.PLAYER), "players use player-protection");
        assertFalse(policy.isHiddenType(EntityType.MINECART), "vehicles are not living types");
    }

    @Test
    void emptyExplicitEntityListStillGetsDefaultProtection() {
        YamlConfiguration cfg = new YamlConfiguration();
        cfg.set("worlds.default.item-protection.hidden-entity-types", List.of());

        AegishiderConfig config = ConfigLoader.load(cfg, 1L);
        WorldSettings.ItemProtection policy = config.world("world").itemProtection();

        assertTrue(policy.isHiddenType(EntityType.ZOMBIE),
                "an empty list must not downgrade entity protection to items only");
        assertTrue(policy.isHiddenType(EntityType.COW),
                "an empty list must not leave animals visible");
        assertTrue(policy.isHiddenType(EntityType.VILLAGER),
                "an empty list must not leave villagers visible");
        assertTrue(config.warnings().stream().anyMatch(w -> w.contains("built-in")));
    }

    @Test
    void explicitMonsterListWithoutOptOutStillHidesAnimals() {
        YamlConfiguration cfg = new YamlConfiguration();
        cfg.set("worlds.default.item-protection.hidden-entity-types",
                List.of("ITEM", "ZOMBIE"));

        WorldSettings.ItemProtection policy = ConfigLoader.load(cfg, 1L)
                .world("world").itemProtection();

        assertTrue(policy.protectAllLiving(),
                "hide-all-living-entities defaults to true even with an explicit list");
        assertTrue(policy.isHiddenType(EntityType.ZOMBIE), "explicitly listed monster");
        assertTrue(policy.isHiddenType(EntityType.COW), "animal covered by the default");
        assertTrue(policy.isHiddenType(EntityType.VILLAGER), "villager covered by the default");
    }

    @Test
    void animalsAndVillagersCanBeOptedOutExplicitly() {
        YamlConfiguration cfg = new YamlConfiguration();
        cfg.set("worlds.default.item-protection.hidden-entity-types",
                List.of("ITEM", "ZOMBIE"));
        cfg.set("worlds.default.item-protection.hide-all-living-entities", false);

        WorldSettings.ItemProtection policy = ConfigLoader.load(cfg, 1L)
                .world("world").itemProtection();

        assertFalse(policy.protectAllLiving());
        assertTrue(policy.isHiddenType(EntityType.ZOMBIE), "explicitly listed monster");
        assertFalse(policy.isHiddenType(EntityType.COW), "opt-out keeps animal hitboxes");
        assertFalse(policy.isHiddenType(EntityType.VILLAGER), "opt-out keeps trading halls");
    }

    @Test
    void allLivingMobTypesCanBeHiddenTogether() {
        YamlConfiguration cfg = new YamlConfiguration();
        cfg.set("worlds.default.item-protection.hidden-entity-types", List.of("ITEM"));
        cfg.set("worlds.default.item-protection.hide-all-living-entities", true);

        WorldSettings.ItemProtection policy = ConfigLoader.load(cfg, 1L)
                .world("world").itemProtection();
        assertTrue(policy.protectAllLiving());
        for (EntityType type : MONSTERS) {
            assertTrue(policy.isHiddenType(type), type + " must be tracked when all living is on");
        }
        for (EntityType type : ANIMALS) {
            assertTrue(policy.isHiddenType(type), type + " must be tracked when all living is on");
        }
        assertFalse(policy.isHiddenType(EntityType.PLAYER));
        assertFalse(policy.isHiddenType(EntityType.MINECART));
    }

    @Test
    void yShieldHidesMonstersAndAnimalsBelowTheLine() {
        WorldSettings.YShield shield = new WorldSettings.YShield(true, 40, 0, Material.STONE);

        // The entity type does not change the Y rule: monsters and animals both use it.
        assertTrue(shield.masksEntity(45.0, 39.0), "monster/animal below the line is hidden");
        assertTrue(shield.masksEntity(45.0, -20.0), "deep cow/villager/monster is hidden");
        assertTrue(shield.masksEntity(90.0, 30.0),
                "a surface viewer never receives a mob or animal inside a deep base");
        assertFalse(shield.masksEntity(42.0, 39.0),
                "same-floor monster/animal stays visible inside the 4-block dead band");
        assertFalse(shield.masksEntity(45.0, 40.0), "entity at/above the line stays visible");
        assertFalse(shield.masksEntity(41.0, 39.0),
                "a viewer below the line sees the real world");
    }

    @Test
    void entityHeightShieldSeparatesAnimalsAcrossFloors() {
        WorldSettings.EntityHeightShield shield =
                new WorldSettings.EntityHeightShield(true, 16.0, 50.0, 12.0);

        assertTrue(shield.separates(70.0, 30.0),
                "a cow in a deep pen is hidden from the surface");
        assertTrue(shield.separates(30.0, 70.0),
                "a surface cow is hidden from inside the base");
        assertFalse(shield.separates(46.0, 39.0),
                "same-floor animals near the cut line stay visible");
        assertFalse(shield.separates(70.0, 58.0),
                "vertical gap within max-vertical-distance stays visible");
        assertFalse(shield.separates(100.0, 80.0),
                "normal surface gameplay is unaffected above the underground band");
    }

    @Test
    void distanceGateHidesMonstersAndAnimalsBeyondTheConfiguredRadius() {
        assertTrue(ItemShield.withinRevealDistance(24.0 * 24.0, 24.0),
                "animal at the item radius is still eligible");
        assertFalse(ItemShield.withinRevealDistance(24.01 * 24.01, 24.0),
                "normal item/animal reveal radius hides beyond 24 blocks");
        assertTrue(ItemShield.withinRevealDistance(96.0 * 96.0, 96.0),
                "monster/animal at the occlusion radius is still eligible");
        assertFalse(ItemShield.withinRevealDistance(96.01 * 96.01, 96.0),
                "living mobs are hidden beyond monster-max-distance");
    }

    @Test
    void interactionFloorKeepsThreeBlocksVisible() {
        assertTrue(ItemShield.withinInteractionRange(0.0),
                "a cow/villager/monster inside the viewer is visible");
        assertTrue(ItemShield.withinInteractionRange(3.0 * 3.0),
                "the 3-block interaction/attack floor is inclusive");
        assertFalse(ItemShield.withinInteractionRange(3.01 * 3.01),
                "beyond 3 blocks the normal occlusion policy takes over");
    }

    @Test
    void builtinPolicyKeepsConfiguredRevealDistancesAndMeleeFloor() {
        WorldSettings.ItemProtection policy = ConfigLoader.load(new YamlConfiguration(), 1L)
                .world("world").itemProtection();
        assertEquals(24.0, policy.revealDistance(), 1e-9);
        assertEquals(96.0, policy.monsterMaxDistance(), 1e-9);
        assertEquals(3.0, policy.mobMeleeVisibleDistance(), 1e-9);
        assertTrue(policy.occlusionOnlyMonsters(),
                "living mobs keep the fair occlusion-only policy by default");
    }
}
