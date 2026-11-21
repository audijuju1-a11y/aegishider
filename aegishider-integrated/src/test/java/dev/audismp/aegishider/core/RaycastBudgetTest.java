package dev.audismp.aegishider.core;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RaycastBudgetTest {

    @Test
    void keepsAThirdOfThePoolForEntities() {
        RaycastBudget budget = new RaycastBudget(180);
        assertEquals(60, budget.reservedForEntities());

        for (int i = 0; i < 120; i++) {
            assertTrue(budget.tryConsumeBlock());
        }
        assertFalse(budget.tryConsumeBlock());
        assertEquals(60, budget.remaining());

        for (int i = 0; i < 60; i++) {
            assertTrue(budget.tryConsume());
        }
        assertFalse(budget.tryConsume());
        assertEquals(0, budget.remaining());
    }

    @Test
    void capsTheReserveAndHandlesTinyOrDisabledPools() {
        assertEquals(60, new RaycastBudget(1000).reservedForEntities());
        assertEquals(0, new RaycastBudget(2).reservedForEntities());
        RaycastBudget disabled = new RaycastBudget(0);
        assertFalse(disabled.tryConsumeBlock());
        assertFalse(disabled.tryConsume());

        RaycastBudget budget = new RaycastBudget(9);
        budget.reset(9);
        for (int i = 0; i < 6; i++) {
            assertTrue(budget.tryConsumeBlock());
        }
        assertFalse(budget.tryConsumeBlock());
        assertEquals(3, budget.remaining());
    }
}
