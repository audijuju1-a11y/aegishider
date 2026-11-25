package dev.audismp.aegishider.config;

import org.bukkit.World;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ConfigLoaderDimensionsTest {

    @Test
    void netherAndEndDefaultToYShieldDisabled() {
        YamlConfiguration cfg = new YamlConfiguration();
        cfg.set("worlds.default.enabled", true);

        AegishiderConfig config = ConfigLoader.load(cfg, 1L, Map.of(
                "world", World.Environment.NORMAL,
                "world_nether", World.Environment.NETHER,
                "world_the_end", World.Environment.THE_END));

        assertTrue(config.world("world").yShield().enabled(),
                "the overworld keeps the full-volume base shield");
        assertFalse(config.world("world_nether").yShield().enabled(),
                "the Nether lava sea/fortresses must not be replaced with stone");
        assertFalse(config.world("world_the_end").yShield().enabled(),
                "the End void must not be filled with stone");
    }

    @Test
    void explicitNetherYShieldOverrideIsHonoured() {
        YamlConfiguration cfg = new YamlConfiguration();
        cfg.set("worlds.default.enabled", true);
        cfg.set("worlds.world_nether.y-shield.enabled", true);
        cfg.set("worlds.world_nether.y-shield.hide-below-y", 32);

        AegishiderConfig config = ConfigLoader.load(cfg, 1L, Map.of(
                "world", World.Environment.NORMAL,
                "world_nether", World.Environment.NETHER));

        assertTrue(config.world("world_nether").yShield().enabled());
    }

    @Test
    void explicitOptOutKeepsAnimalsVisibleWhileMonsterListStillWorks() {
        YamlConfiguration cfg = new YamlConfiguration();
        cfg.set("worlds.default.item-protection.hidden-entity-types",
                java.util.List.of("ITEM", "ZOMBIE"));
        cfg.set("worlds.default.item-protection.hide-all-living-entities", false);

        AegishiderConfig config = ConfigLoader.load(cfg, 1L);
        WorldSettings settings = config.world("world");
        assertFalse(settings.itemProtection().protectAllLiving());
        assertFalse(settings.itemProtection().isHiddenType(org.bukkit.entity.EntityType.VILLAGER));
        assertFalse(settings.itemProtection().isHiddenType(org.bukkit.entity.EntityType.COW));
        assertTrue(settings.itemProtection().isHiddenType(org.bukkit.entity.EntityType.ZOMBIE),
                "an explicitly listed hostile mob stays protected");
    }
}
