package io.restaurantos.shared.money;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.NumberFormat;
import java.util.Locale;

/** BIGINT-paisa arithmetic utilities (XCUT-03). Never use double/float for money calculations. */
public final class MoneyUtils {
    private static final Locale EN_PK = Locale.forLanguageTag("en-PK");
    private MoneyUtils() {}

    public static Money toMoney(long paisa) {
        double pkr = paisa / 100.0;
        return new Money(paisa, pkr, formatPkr(paisa));
    }

    /** Convert a PKR BigDecimal to paisa using HALF_UP rounding (spec XCUT-03). */
    public static long fromPkr(BigDecimal pkr) {
        return pkr.multiply(BigDecimal.valueOf(100)).setScale(0, RoundingMode.HALF_UP).longValueExact();
    }

    public static String formatPkr(long paisa) {
        NumberFormat nf = NumberFormat.getCurrencyInstance(EN_PK);
        nf.setMinimumFractionDigits(0);
        nf.setMaximumFractionDigits(0);
        return nf.format(paisa / 100.0);
    }

    /** Add two paisa amounts. Both operands MUST be in paisa. */
    public static long add(long a, long b) { return a + b; }

    /** Multiply paisa by a rate expressed in basis points (1 bps = 0.01%). Result floored. */
    public static long multiplyBps(long paisa, int bps) {
        return (paisa * bps) / 10000;
    }

    /** Apply a tax rate in basis points per-line using FLOOR (spec XCUT-03 per-line floored tax). */
    public static long taxPerLine(long linePaisa, int taxBps) {
        return (linePaisa * taxBps) / 10000;
    }

    /** Round a paisa value to the nearest whole rupee using HALF_UP. */
    public static long roundToRupee(long paisa) {
        BigDecimal bd = BigDecimal.valueOf(paisa);
        return bd.divide(BigDecimal.valueOf(100), 0, RoundingMode.HALF_UP)
                  .multiply(BigDecimal.valueOf(100))
                  .longValue();
    }
}
