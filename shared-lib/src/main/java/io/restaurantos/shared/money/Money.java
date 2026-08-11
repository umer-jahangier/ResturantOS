package io.restaurantos.shared.money;

/**
 * All money in the system is integer paisa (1 PKR = 100 paisa).
 *
 * @param paisa the amount of record — the only field safe to compute with
 * @param pkr   <strong>deprecated.</strong> See {@link #pkr()}
 * @param formatted the display string, produced by {@link MoneyUtils#formatPkr(long)}
 */
public record Money(long paisa, double pkr, String formatted) {

    /**
     * A binary floating-point rupee value, retained only for backward compatibility with callers
     * that already read it.
     *
     * <p><strong>Never use it for arithmetic or comparison.</strong> A {@code double} cannot hold
     * every paisa value exactly — past 2^53 paisa it silently loses the minor unit, and summing a
     * column of them accumulates representation error that no downstream rounding removes. This
     * project has already shipped a 1000×-wrong COGS figure from a double. Use {@link #paisa()},
     * which is the integer of record, and convert only at display through
     * {@link MoneyUtils#formatPkr(long)}.
     *
     * @deprecated use {@link #paisa()} for any computation and {@link #formatted()} for display
     */
    @Deprecated
    @Override
    public double pkr() {
        return pkr;
    }
}
