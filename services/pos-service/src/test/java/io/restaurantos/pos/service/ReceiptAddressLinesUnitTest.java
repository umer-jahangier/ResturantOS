package io.restaurantos.pos.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The branch address reaches the paper (S4).
 *
 * <h2>Why this test exists and what it caught</h2>
 *
 * <p>{@code branches.address} was a jsonb column, which made every plain address an owner typed
 * fail with 409 CONFLICT. Changeset 021 converts it to TEXT. That fix moves a hazard downstream:
 * this service used to read the column with {@code objectMapper.readTree}, and Jackson does not
 * refuse a plain sentence — with {@code FAIL_ON_TRAILING_TOKENS} off (the default) it reads the
 * leading {@code 12} of "12 Khayaban-e-Iqbal, F-7 Markaz, Islamabad" as an IntNode and throws the
 * rest away. An IntNode is not textual, not an array and not an object, so the old code fell
 * through every branch and returned an empty list: the address disappeared from the customer's
 * receipt, silently, with no log line and no exception.
 *
 * <p>The first case below is that one. It fails against the pre-S4 implementation — measured, not
 * assumed — and it is a unit test rather than an IT so it can be run against both.
 */
class ReceiptAddressLinesUnitTest {

    @Test
    @DisplayName("a plain address that STARTS WITH A DIGIT survives — the case the JSON parser ate")
    void plainAddressStartingWithADigitIsPrinted() {
        assertThat(ReceiptDocumentAssembler.addressLines("12 Khayaban-e-Iqbal, F-7 Markaz, Islamabad"))
                .containsExactly("12 Khayaban-e-Iqbal, F-7 Markaz, Islamabad");
    }

    @Test
    @DisplayName("a plain address starting with a letter survives too")
    void plainAddressStartingWithALetterIsPrinted() {
        assertThat(ReceiptDocumentAssembler.addressLines("Islamabad"))
                .containsExactly("Islamabad");
    }

    @Test
    @DisplayName("an address that is only digits is an address, not a number to be swallowed")
    void numericOnlyAddressIsPrinted() {
        assertThat(ReceiptDocumentAssembler.addressLines("44000")).containsExactly("44000");
    }

    @Test
    @DisplayName("newlines separate printed lines; blank lines and stray spacing do not print")
    void newlinesBecomeLines() {
        assertThat(ReceiptDocumentAssembler.addressLines("12 Khayaban-e-Iqbal\n\n  F-7 Markaz  \nIslamabad"))
                .containsExactly("12 Khayaban-e-Iqbal", "F-7 Markaz", "Islamabad");
    }

    @Test
    @DisplayName("a branch with no address prints no address lines rather than a blank one")
    void nullAndBlankProduceNoLines() {
        assertThat(ReceiptDocumentAssembler.addressLines(null)).isEmpty();
        assertThat(ReceiptDocumentAssembler.addressLines("")).isEmpty();
        assertThat(ReceiptDocumentAssembler.addressLines("   ")).isEmpty();
    }

    /**
     * Not a JSON reader any more, deliberately. Changeset 021 flattens every object- and
     * array-shaped row that ever existed, so a branch whose address arrives here still wearing
     * braces is a row nobody migrated — and printing it verbatim is the honest outcome. Silently
     * re-deriving lines from it would hide the fact that the row was missed.
     */
    @Test
    @DisplayName("JSON braces are not interpreted — the text is the address")
    void jsonLookingTextIsPrintedVerbatim() {
        assertThat(ReceiptDocumentAssembler.addressLines("{\"city\": \"Karachi\"}"))
                .containsExactly("{\"city\": \"Karachi\"}");
    }
}
