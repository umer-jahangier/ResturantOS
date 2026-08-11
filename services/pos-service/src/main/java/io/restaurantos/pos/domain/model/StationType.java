package io.restaurantos.pos.domain.model;

/**
 * What KIND of destination a station is (D-28-01).
 *
 * <p>The question this answers is <b>"which display shows this station's tickets"</b>. A bar ticket
 * landing on the kitchen board is the failure the type exists to close: today a kitchen account sees
 * every ticket at the branch, so a bartender watches biryani scroll past and a cook waits behind a
 * mojito.
 *
 * <p><b>An enum, not free text, and that is the whole point.</b> Free text is how "Bar", "bar" and
 * "BAR " become three stations that each receive a third of the drinks, with nobody able to see why.
 * A {@code CHECK} constraint in {@code V14__station_type.sql} enforces the same closure at the
 * database, so an out-of-range value is refused twice and cannot be introduced by a direct write
 * either. New values are added by migration, deliberately: adding a destination kind to a
 * restaurant platform is a decision, not a typo.
 *
 * <h2>Five values, three display families</h2>
 *
 * <p>The phase research argued for three values; D-28-01 locks five. Both are honoured here. The
 * five exist because an operator needs to <em>name and filter</em> their pantry separately from
 * their grill — that is a real distinction on a real floor. The three display families exist
 * because inventing five boards would mean three of them are empty in most restaurants, and an
 * empty board is a screen somebody has to be told to ignore.
 *
 * <pre>
 *   KITCHEN  → KITCHEN family    the hot line
 *   PANTRY   → KITCHEN family    cold prep, salads, sides
 *   DESSERT  → KITCHEN family    the sweet station
 *   BAR      → BAR family        its own display; drinks never appear on a cooking board
 *   EXPO     → EXPO family       the pass; sees everything, which is what KdsController.getTickets
 *                                already does when no station code is given
 * </pre>
 *
 * <p>{@link #displayFamily()} is the single place that mapping lives. Every consumer asks it rather
 * than re-deriving it, because a second copy of this table is a second answer to "does a dessert go
 * to the kitchen screen", and the two would disagree the first time a value was added.
 */
public enum StationType {

    /** The hot line. The default, and what every station that existed before this type did. */
    KITCHEN(DisplayFamily.KITCHEN),

    /** Drinks. Its own display family — a bar ticket must never land on a cooking board. */
    BAR(DisplayFamily.BAR),

    /** Cold prep: salads, sides, garnish. Cooks' board, named separately so it can be filtered. */
    PANTRY(DisplayFamily.KITCHEN),

    /** The pass. Sees everything, which is the unfiltered view the KDS already offers. */
    EXPO(DisplayFamily.EXPO),

    /** The sweet station. Cooks' board, named separately so it can be filtered. */
    DESSERT(DisplayFamily.KITCHEN);

    /** Which physical screen a station's tickets belong on. */
    public enum DisplayFamily { KITCHEN, BAR, EXPO }

    /** The type a station has when nobody said. Every pre-existing row is this, by migration. */
    public static final StationType DEFAULT = KITCHEN;

    private final DisplayFamily displayFamily;

    StationType(DisplayFamily displayFamily) {
        this.displayFamily = displayFamily;
    }

    public DisplayFamily displayFamily() {
        return displayFamily;
    }

    /**
     * Parse a wire value, falling back to {@link #DEFAULT} for null, blank or unknown.
     *
     * <p>Falls back rather than throwing because this is used on the CONSUMER side of an event, and
     * a message from a producer on an older build legitimately carries no type. Refusing it would
     * dead-letter a ticket that a kitchen is waiting on. Validation of client input is a separate
     * concern and happens at the request DTO, where throwing is correct.
     */
    public static StationType fromWire(String raw) {
        if (raw == null || raw.isBlank()) {
            return DEFAULT;
        }
        try {
            return StationType.valueOf(raw.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            return DEFAULT;
        }
    }
}
