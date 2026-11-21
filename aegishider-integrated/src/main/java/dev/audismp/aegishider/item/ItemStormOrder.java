package dev.audismp.aegishider.item;

/**
 * Deterministic ordering for spawn-storm batches: items that are near (or owned by) a viewer
 * are evaluated first, so a large burst of item spawns reveals the gameplay-relevant items
 * immediately while far items are deferred to later ticks.
 *
 * <p>Pure and unit-tested; no Bukkit types involved.
 */
final class ItemStormOrder {

    private ItemStormOrder() {
    }

    /**
     * @param ownerVisiblePerItem true when the item's thrower is one of the candidate viewers
     * @param minDistanceSq       squared distance to the nearest candidate viewer; use
     *                            {@link Double#MAX_VALUE} when there is no candidate
     * @return indices sorted by (ownerVisible first, then nearest distance)
     */
    static int[] order(boolean[] ownerVisiblePerItem, double[] minDistanceSq) {
        int size = ownerVisiblePerItem.length;
        Integer[] boxed = new Integer[size];
        for (int i = 0; i < size; i++) {
            boxed[i] = i;
        }
        java.util.Arrays.sort(boxed, (a, b) -> {
            boolean ownerA = ownerVisiblePerItem[a];
            boolean ownerB = ownerVisiblePerItem[b];
            if (ownerA != ownerB) {
                return ownerA ? -1 : 1;
            }
            return Double.compare(minDistanceSq[a], minDistanceSq[b]);
        });
        int[] result = new int[size];
        for (int i = 0; i < size; i++) {
            result[i] = boxed[i];
        }
        return result;
    }
}
