package dev.audismp.aegishider.occlusion;

import dev.audismp.aegishider.config.WorldSettings;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OcclusionEngineTest {

    @Test
    void fovInsideAndOutside() {
        // Viewer at origin looking straight along +X.
        double cos90 = Math.cos(Math.toRadians(45));
        assertTrue(OcclusionEngine.insideFov(0, 0, 0, 1, 0, 0,
                10, 0, 0, cos90));
        assertTrue(OcclusionEngine.insideFov(0, 0, 0, 1, 0, 0,
                5, 4, 0, cos90), "inside a 90 degree cone");
        assertFalse(OcclusionEngine.insideFov(0, 0, 0, 1, 0, 0,
                -5, 0, 0, cos90), "behind the viewer");
        assertFalse(OcclusionEngine.insideFov(0, 0, 0, 1, 0, 0,
                2, 10, 0, cos90), "outside the cone");
    }

    @Test
    void fovConeBoundaryIsInclusive() {
        double cos45 = Math.cos(Math.toRadians(45));
        // A point exactly on the 45 degree boundary must be inside.
        assertTrue(OcclusionEngine.insideFov(0, 0, 0, 1, 0, 0, 1, 1, 0, cos45));
    }

    @Test
    void fov360DisablesTheGateInEveryDirection() {
        // Negative is the explicit disabled sentinel returned for fovDegrees >= 360.
        assertTrue(OcclusionEngine.insideFov(0, 0, 0, 1, 0, 0,
                10, 0, 0, -1.0));
        assertTrue(OcclusionEngine.insideFov(0, 0, 0, 1, 0, 0,
                -5, 0, 0, -1.0), "F5 front view / fast turn: behind is still on screen");
        assertTrue(OcclusionEngine.insideFov(0, 0, 0, 1, 0, 0,
                0, 0, -5, -1.0));
    }

    @Test
    void fov180IsTheFrontHemisphereNotAFullSphere() {
        double cos90 = Math.cos(Math.toRadians(90));
        assertTrue(OcclusionEngine.insideFov(0, 0, 0, 1, 0, 0,
                5, 4, 0, cos90));
        assertFalse(OcclusionEngine.insideFov(0, 0, 0, 1, 0, 0,
                -5, 0, 0, cos90));
    }

    @Test
    void only360DisablesTheGate() {
        // A value just below 360 must stay a hemisphere instead of accidentally
        // becoming the disabled sentinel through a negative cosine.
        double cos270 = WorldSettings.fovCosHalfFor(270.0);
        assertTrue(cos270 >= 0.0, "270 should clamp to the front hemisphere");
        assertTrue(OcclusionEngine.insideFov(0, 0, 0, 1, 0, 0, 5, 0, 0, cos270));
        assertFalse(OcclusionEngine.insideFov(0, 0, 0, 1, 0, 0, -5, 0, 0, cos270));
        assertTrue(WorldSettings.fovCosHalfFor(360.0) < 0.0);
    }

    @Test
    void zeroDistanceIsVisible() {
        assertTrue(OcclusionEngine.insideFov(0, 0, 0, 1, 0, 0, 0, 0, 0, 0.5));
    }

    @Test
    void rayTracerControlsResult() {
        RayTracer blocked = (world, ex, ey, ez, tx, ty, tz) -> true;
        RayTracer clear = (world, ex, ey, ez, tx, ty, tz) -> false;
        OcclusionEngine engine = new OcclusionEngine(blocked);
        assertFalse(engine.hasLineOfSight(null, 0, 0, 0, 5, 0, 0));
        OcclusionEngine open = new OcclusionEngine(clear);
        assertTrue(open.hasLineOfSight(null, 0, 0, 0, 5, 0, 0));
    }

    @Test
    void anyLineOfSightAcceptsEitherSample() {
        // Only targets below y=1.6 are clear: the centre sample is blocked, the head is not.
        RayTracer onlyHeadVisible = (world, ex, ey, ez, tx, ty, tz) -> ty < 1.6;
        OcclusionEngine engine = new OcclusionEngine(onlyHeadVisible);
        assertTrue(engine.anyLineOfSight(null, 0, 0, 0, 5, 0, 1.0, 1.8),
                "a visible head sample must reveal a partially covered mob");
        assertFalse(engine.anyLineOfSight(null, 0, 0, 0, 5, 0, 1.0, 1.2),
                "both samples blocked means hidden");
    }

    @Test
    void distanceSquaredIsCorrect() {
        assertTrue(Math.abs(OcclusionEngine.distanceSq(0, 0, 0, 3, 4, 0) - 25.0) < 1e-9);
    }
}
