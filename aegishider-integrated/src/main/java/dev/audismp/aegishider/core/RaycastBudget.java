package dev.audismp.aegishider.core;

/**
 * Shared per-tick raycast budget. Block reveal and entity reveal engines draw from the
 * same pool so a storage-cluster scan cannot starve item visibility (and vice versa).
 *
 * <p>When the budget is exhausted the calling engine defers the check and keeps the
 * object in its previous (fail-closed) state; nothing is revealed without a completed
 * positive check.
 */
public final class RaycastBudget {

    private int remaining;
    private int limit;
    private int reservedForEntities;

    public RaycastBudget(int limit) {
        applyLimit(limit);
    }

    public void reset(int newLimit) {
        applyLimit(newLimit);
    }

    private void applyLimit(int newLimit) {
        this.limit = Math.max(0, newLimit);
        this.remaining = this.limit;
        // Keep at least a third (max 60) of the pool for dropped items and entities so a
        // dense storage scan cannot starve a nearby item for long enough to blink out.
        this.reservedForEntities = Math.min(60, this.limit / 3);
    }

    /** Entity/item path: may use the whole pool. */
    public boolean tryConsume() {
        if (remaining <= 0) {
            return false;
        }
        remaining--;
        return true;
    }

    /** Block path: never dips into the entity reserve. */
    public boolean tryConsumeBlock() {
        if (remaining <= reservedForEntities) {
            return false;
        }
        remaining--;
        return true;
    }

    public int remaining() {
        return remaining;
    }

    public int limit() {
        return limit;
    }

    public int reservedForEntities() {
        return reservedForEntities;
    }
}
