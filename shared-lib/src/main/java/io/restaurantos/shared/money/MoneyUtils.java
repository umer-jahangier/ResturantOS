package io.restaurantos.shared.money;

import io.restaurantos.shared.print.ReceiptMoneyFormatter;

import java.math.BigDecimal;
import java.math.RoundingMode;

/** BIGINT-paisa arithmetic utilities (XCUT-03). Never use double/float for money calculations. */
public final class MoneyUtils {
    private MoneyUtils() {}

    public static Money toMoney(long paisa) {
        double pkr = paisa / 100.0;
        return new Money(paisa, pkr, formatPkr(paisa));
    }

    /** Convert a PKR BigDecimal to paisa using HALF_UP rounding (spec XCUT-03). */
    public static long fromPkr(BigDecimal pkr) {
        return pkr.multiply(BigDecimal.valueOf(100)).setScale(0, RoundingMode.HALF_UP).longValueExact();
    }

    /**
     * THE JVM rule for turning integer paisa into the string a human reads (D-37-01).
     *
     * <p>This method used to configure a {@code NumberFormat} with zero maximum fraction digits
     * and hand it {@code paisa / 100.0}. Three separate faults in four lines: 123456 paisa came
     * out as {@code Rs1,235} — a rupee <em>higher</em> than the ledger, with the minor unit gone —
     * a value beyond 2^53 paisa lost its last digit to the double, and the rendering depended on
     * whichever locale the JVM happened to boot with.
     *
     * <p>It now delegates to {@link ReceiptMoneyFormatter}, the formatter already printing on
     * customer receipts, so a screen, a printed bill and the general ledger cannot show three
     * different numbers for one integer. Do not reintroduce grouping, a prefix or a locale here;
     * a second implementation is how the disagreement started.
     *
     * @see io.restaurantos.shared.money.MoneyUtils MoneyDisplayAuthorityTest, which asserts this
     *      against a vector file the frontend's test reads too
     */
    public static String formatPkr(long paisa) {
        return ReceiptMoneyFormatter.format(paisa);
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
