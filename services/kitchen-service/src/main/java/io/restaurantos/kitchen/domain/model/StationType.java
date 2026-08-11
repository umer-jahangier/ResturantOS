package io.restaurantos.kitchen.domain.model;

/**
 * What KIND of destination a projected station is (D-28-01) — and therefore which board shows it.
 *
 * <p><b>This is a deliberate MIRROR of {@code io.restaurantos.pos.domain.model.StationType}.</b> The
 * two services do not share a domain module and must not: kitchen-service has to keep serving its
 * board when pos-service is down, which is the entire reason {@code kds_stations} is a projection
 * rather than a lookup. The same mirroring convention already governs
 * {@code KitchenEventPayloads.OrderSentToKdsItem} against {@code PosEventPayloads.KdsItemPayload},
 * and it carries the same obligation: <b>the value names must stay identical, and values are only
 * ever appended.</b> A name that drifts does not fail — it silently reads as the default.
 *
 * <pre>
 *   KITCHEN  → KITCHEN family    the hot line (the default; every pre-phase-28 row)
 *   PANTRY   → KITCHEN family    cold prep
 *   DESSERT  → KITCHEN family    the sweet station
 *   BAR      → BAR family        its own display
 *   EXPO     → EXPO family       the pass; sees everything
 * </pre>
 */
public enum StationType {

    KITCHEN(DisplayFamily.KITCHEN),
    BAR(DisplayFamily.BAR),
    PANTRY(DisplayFamily.KITCHEN),
    EXPO(DisplayFamily.EXPO),
    DESSERT(DisplayFamily.KITCHEN);

    public enum DisplayFamily { KITCHEN, BAR, EXPO }

    /** The type a projected station has when the event did not say. */
    public static final StationType DEFAULT = KITCHEN;

    private final DisplayFamily displayFamily;

    StationType(DisplayFamily displayFamily) {
        this.displayFamily = displayFamily;
    }

    public DisplayFamily displayFamily() {
        return displayFamily;
    }

    /**
     * Parse a wire value, or null when the producer did not send one.
     *
     * <p>Returns null rather than the default for an absent value, and that distinction is
     * load-bearing: {@code TicketRoutingService.upsertStation} must be able to tell "this producer
     * has no opinion" from "this producer says KITCHEN". Without it, a partial rollout where one
     * pos-service instance is still on the old build walks every BAR station back to KITCHEN, one
     * fire at a time, and nobody can see why the drinks started appearing on the cooking board.
     *
     * <p>An unknown-but-present value also returns null — a consumer on an older build meeting a
     * type added by a newer producer must leave the stored value alone, not overwrite it with a
     * guess.
     */
    public static StationType fromWireOrNull(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return StationType.valueOf(raw.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
