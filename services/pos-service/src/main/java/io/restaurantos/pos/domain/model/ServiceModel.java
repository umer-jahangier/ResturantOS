package io.restaurantos.pos.domain.model;

/**
 * How a terminal is operated (D-28-03).
 *
 * <p>It decides which defaults a terminal offers and whether the table picker is shown. It is
 * <b>not a security control</b> and nothing reads it to make an authorization decision — a
 * SELF_SERVE terminal is not "less trusted" than a COUNTER one, it simply has no waiter to pick a
 * table for. Stated explicitly because a field named "model" on a thing named "terminal" invites
 * exactly that misreading.
 */
public enum ServiceModel {

    /** A till. The operator takes the order, the guest waits or takes it away. No table picker. */
    COUNTER,

    /** A waiter station. Orders are attached to a dining table, so the table picker is shown. */
    TABLE_SERVICE,

    /** A kiosk the guest operates. Same order path; no cashier identity behind the screen. */
    SELF_SERVE;

    public static final ServiceModel DEFAULT = COUNTER;
}
