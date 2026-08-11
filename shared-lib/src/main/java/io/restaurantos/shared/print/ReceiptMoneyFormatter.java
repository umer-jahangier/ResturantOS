package io.restaurantos.shared.print;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * THE single conversion site named by D-26-04 — "money converts at the print layer and nowhere
 * else". Integer paisa in, the string a customer reads out.
 *
 * <h2>Why this is not {@code MoneyUtils.formatPkr}</h2>
 *
 * <p>The obvious move is to reuse the existing shared-lib money formatter. Do not. That method
 * calls {@code setMaximumFractionDigits(0)}, so a bill of 123456 paisa renders as a whole-rupee
 * figure and the printed paper disagrees with the ledger by 56 paisa — permanently, because the
 * customer keeps the paper and the ledger keeps the truth. This class renders the minor unit
 * explicitly and always. That duplication is deliberate; it is not a simplification opportunity.
 *
 * <h2>Why nothing here is locale-sensitive</h2>
 *
 * <p>Every JDK formatter that takes a {@code Locale} takes the JVM default when you omit one, and
 * a till's operating-system locale is not a business decision. A German-locale JVM swaps the
 * decimal separator and the grouping separator, which would silently turn {@code Rs 1,234.56} into
 * {@code Rs 1.234,56} on one machine in one branch. The grouping and the decimal point here are
 * assembled by hand from a {@link BigDecimal}'s plain string, so there is no locale to get wrong.
 *
 * <h2>Why no floating-point type appears below</h2>
 *
 * <p>Money is BIGINT paisa on the wire, in the database and in {@link ReceiptAmount}. The moment a
 * receipt total passes through a binary floating-point type it acquires a representation error
 * that no amount of downstream care removes. {@link BigDecimal} with an explicit scale of two is
 * the only arithmetic used here.
 *
 * @see ReceiptAmount the only money shape a {@link PrintDocument} may contain
 */
public final class ReceiptMoneyFormatter {

    /**
     * The PKR symbol the rest of the product already renders — the frontend's {@code toMoney}
     * documents its output as {@code "Rs 1,234.00"} and the JDK's {@code en-PK} currency instance
     * resolves the same symbol. A plain ASCII space follows it rather than the non-breaking space
     * {@code Intl.NumberFormat} emits, because this string is destined for a thermal printer whose
     * codepage may not carry U+00A0.
     */
    public static final String DEFAULT_CURRENCY_PREFIX = "Rs ";

    /** The minor unit: 100 paisa to the rupee, fixed, everywhere. */
    private static final int MINOR_UNIT_SCALE = 2;

    private static final char GROUPING_SEPARATOR = ',';
    private static final char DECIMAL_SEPARATOR = '.';
    private static final int GROUP_SIZE = 3;

    private ReceiptMoneyFormatter() {}

    /** Render {@code paisa} with the product's default currency prefix. */
    public static String format(long paisa) {
        return format(paisa, DEFAULT_CURRENCY_PREFIX);
    }

    /**
     * Render {@code paisa} with an explicit currency prefix, supplied per call from the branch's
     * currency setting. Pass {@code ""} for a bare amount (a totals column that carries its
     * currency in the header rather than on every row).
     *
     * <p>A negative amount takes a LEADING sign — {@code -Rs 500.00}, never {@code (Rs 500.00)}.
     * A discount line on a customer receipt is not a trial-balance entry.
     */
    public static String format(long paisa, String currencyPrefix) {
        if (currencyPrefix == null) {
            throw new IllegalArgumentException("currencyPrefix must not be null; pass \"\" for no prefix");
        }
        BigDecimal amount = BigDecimal.valueOf(paisa).movePointLeft(MINOR_UNIT_SCALE);
        // UNNECESSARY, not HALF_UP: an integer paisa value shifted two places is exact by
        // construction. If this ever throws, the invariant above this line has been broken and a
        // loud failure beats a rounded receipt.
        String plain = amount.abs().setScale(MINOR_UNIT_SCALE, RoundingMode.UNNECESSARY).toPlainString();

        int separator = plain.indexOf(DECIMAL_SEPARATOR);
        String major = plain.substring(0, separator);
        String minor = plain.substring(separator + 1);

        StringBuilder out = new StringBuilder();
        if (paisa < 0) {
            out.append('-');
        }
        out.append(currencyPrefix);
        appendGrouped(out, major);
        out.append(DECIMAL_SEPARATOR).append(minor);
        return out.toString();
    }

    /**
     * The inverse of {@link #format(long, String)} — the companion that makes the round-trip
     * assertion expressible without a second implementation of the format rules.
     *
     * <p>Prefix-agnostic on purpose: it discards every character that is not a digit, a decimal
     * point or a leading sign, so it accepts any currency prefix and any grouping. Its job is to
     * prove that the rendered string still carries the integer it was built from — the assertion
     * that makes a hundredfold error impossible to ship — and it is used by tests and by
     * contract checks, never on a request path.
     *
     * @throws IllegalArgumentException if the string carries no parsable amount
     */
    public static long parse(String rendered) {
        if (rendered == null) {
            throw new IllegalArgumentException("cannot parse a null amount");
        }
        StringBuilder digits = new StringBuilder();
        boolean negative = false;
        boolean seenDigit = false;
        for (int i = 0; i < rendered.length(); i++) {
            char c = rendered.charAt(i);
            if (c == '-' && !seenDigit) {
                negative = true;
            } else if (Character.isDigit(c)) {
                seenDigit = true;
                digits.append(c);
            } else if (c == DECIMAL_SEPARATOR) {
                digits.append(c);
            }
            // Everything else — the currency prefix, grouping separators, whitespace — is noise.
        }
        if (!seenDigit) {
            throw new IllegalArgumentException("no amount found in: " + rendered);
        }
        BigDecimal amount = new BigDecimal((negative ? "-" : "") + digits);
        // movePointRight before longValueExact so that Long.MIN_VALUE paisa, whose absolute value
        // exceeds Long.MAX_VALUE, survives: the sign is carried through the multiplication rather
        // than applied after it.
        return amount.movePointRight(MINOR_UNIT_SCALE)
                .setScale(0, RoundingMode.UNNECESSARY)
                .longValueExact();
    }

    private static void appendGrouped(StringBuilder out, String majorDigits) {
        int length = majorDigits.length();
        for (int i = 0; i < length; i++) {
            if (i > 0 && (length - i) % GROUP_SIZE == 0) {
                out.append(GROUPING_SEPARATOR);
            }
            out.append(majorDigits.charAt(i));
        }
    }
}
