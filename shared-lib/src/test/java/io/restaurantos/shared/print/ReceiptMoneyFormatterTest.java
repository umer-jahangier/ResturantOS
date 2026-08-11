package io.restaurantos.shared.print;

import org.junit.jupiter.api.Test;

import java.util.Locale;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The seven behaviours of the ONE print-money formatter (D-26-04).
 *
 * <p>Every assertion on a rendered amount is against a hard-coded literal string, never against a
 * second call to the formatter. A test that re-formats to build its own expectation cannot fail
 * when the formatter is wrong — it can only fail when the formatter is inconsistent with itself,
 * which is precisely the defect class that shipped the journal-entry screen with every total one
 * hundred times too large.
 */
class ReceiptMoneyFormatterTest {

    // ── Behaviour 1: a whole-rupee amount still renders an explicit two-digit minor unit ──────
    @Test
    void wholeRupeeAmountRendersExplicitTwoDigitMinorUnit() {
        assertEquals("Rs 1,500.00", ReceiptMoneyFormatter.format(150_000L));
        assertEquals("Rs 7.00", ReceiptMoneyFormatter.format(700L));
    }

    // ── Behaviour 2: a non-zero paisa remainder renders EXACTLY ───────────────────────────────
    @Test
    void nonZeroPaisaRemainderRendersExactly() {
        String rendered = ReceiptMoneyFormatter.format(123_456L);
        assertEquals("Rs 1,234.56", rendered);
        assertTrue(rendered.endsWith("56"), "the 56-paisa remainder must survive to the paper");
        // The trap this whole class exists to keep shut: MoneyUtils.formatPkr would render this
        // same value as a whole-rupee figure, putting the paper 56 paisa away from the ledger.
        assertEquals("Rs 0.05", ReceiptMoneyFormatter.format(5L));
        assertEquals("Rs 0.99", ReceiptMoneyFormatter.format(99L));
    }

    // ── Behaviour 3: a negative amount takes a LEADING SIGN, never accounting brackets ────────
    @Test
    void negativeAmountRendersWithLeadingSignNotBrackets() {
        String rendered = ReceiptMoneyFormatter.format(-50_000L);
        assertEquals("-Rs 500.00", rendered);
        assertTrue(rendered.startsWith("-"), "the sign leads; a customer reads a bill, not a trial balance");
        assertFalse(rendered.contains("("), "no accounting brackets on a customer receipt");
        assertFalse(rendered.contains(")"), "no accounting brackets on a customer receipt");
        assertEquals("-Rs 1,234.56", ReceiptMoneyFormatter.format(-123_456L));
    }

    // ── Behaviour 4: zero is visibly zero ─────────────────────────────────────────────────────
    @Test
    void zeroRendersAsAZeroAmountNotAnEmptyStringOrDash() {
        String rendered = ReceiptMoneyFormatter.format(0L);
        assertEquals("Rs 0.00", rendered);
        assertFalse(rendered.isBlank());
        assertFalse(rendered.contains("-"));
    }

    // ── Behaviour 5: the largest value the domain can hold ────────────────────────────────────
    @Test
    void extremeValuesFormatWithoutOverflowOrScientificNotation() {
        String max = ReceiptMoneyFormatter.format(Long.MAX_VALUE);
        assertEquals("Rs 92,233,720,368,547,758.07", max);
        assertFalse(max.contains("E"), "no scientific notation on paper");
        assertFalse(max.contains("e"), "no scientific notation on paper");

        String min = ReceiptMoneyFormatter.format(Long.MIN_VALUE);
        assertEquals("-Rs 92,233,720,368,547,758.08", min);
    }

    // ── Behaviour 6: the round-trip. This is the assertion that makes a 100x error unshippable ─
    @Test
    void everyRenderedStringParsesBackToItsOwnPaisaValue() {
        long[] cases = {
                0L, 1L, 5L, 99L, 100L, 700L, 123_456L, 150_000L,
                -1L, -99L, -50_000L, -123_456L,
                999_999_999L, Long.MAX_VALUE, Long.MIN_VALUE
        };
        for (long paisa : cases) {
            String rendered = ReceiptMoneyFormatter.format(paisa);
            assertEquals(paisa, ReceiptMoneyFormatter.parse(rendered),
                    "round-trip failed for " + paisa + " which rendered as " + rendered);
        }
    }

    // ── Behaviour 7: the prefix is fixed, per-call configurable, and NEVER locale-derived ─────
    @Test
    void currencyPrefixIsConfigurablePerCallAndNeverInferredFromTheJvmLocale() {
        assertEquals("Rs 1,234.56", ReceiptMoneyFormatter.format(123_456L));
        assertEquals("Rs 1,234.56",
                ReceiptMoneyFormatter.format(123_456L, ReceiptMoneyFormatter.DEFAULT_CURRENCY_PREFIX));
        assertEquals("AED 1,234.56", ReceiptMoneyFormatter.format(123_456L, "AED "));
        assertEquals("1,234.56", ReceiptMoneyFormatter.format(123_456L, ""));

        // A till's JVM locale is not a business decision. Germany swaps '.' and ',' in every
        // locale-sensitive formatter in the JDK; this one must not move.
        Locale original = Locale.getDefault();
        try {
            Locale.setDefault(Locale.GERMANY);
            assertEquals("Rs 1,234.56", ReceiptMoneyFormatter.format(123_456L));
            assertEquals(123_456L, ReceiptMoneyFormatter.parse(ReceiptMoneyFormatter.format(123_456L)));
        } finally {
            Locale.setDefault(original);
        }
    }

    // ── ReceiptAmount: the pair can only be built through the formatter ───────────────────────
    @Test
    void receiptAmountCarriesBothPaisaAndItsRenderedStringAndTheyAgree() {
        ReceiptAmount amount = ReceiptAmount.of(123_456L);
        assertEquals(123_456L, amount.paisa());
        assertEquals("Rs 1,234.56", amount.formatted());
        assertEquals(amount.paisa(), ReceiptMoneyFormatter.parse(amount.formatted()));

        ReceiptAmount prefixed = ReceiptAmount.of(123_456L, "AED ");
        assertEquals("AED 1,234.56", prefixed.formatted());
        assertEquals(123_456L, ReceiptMoneyFormatter.parse(prefixed.formatted()));
    }
}
