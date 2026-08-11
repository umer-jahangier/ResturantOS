package io.restaurantos.shared.print;

import java.util.Objects;

/**
 * The ONLY money shape a {@link PrintDocument} may contain: the integer paisa, and the exact
 * string that was rendered from it.
 *
 * <p>Carrying both is the point. A renderer — the HTML bill, the ESC/POS byte stream, the kitchen
 * ticket — reads {@link #formatted()} and prints it verbatim. It never divides {@link #paisa()} by
 * one hundred, never re-formats, never computes. The journal-entry detail screen shipped every
 * total one hundred times too large by doing exactly that arithmetic in the wrong place, and a
 * receipt is the worse place to repeat it: the customer keeps the paper.
 *
 * <p>Carrying both also makes the defect testable. Because the integer travels beside the string,
 * a test — in Java, in the contract suite, and again in the frontend's zod refinement — can parse
 * the string back and assert it still equals the integer. Three independent guards, one of which
 * lives on the other side of the wire.
 *
 * @param paisa     the authoritative integer amount, 100 paisa to the rupee
 * @param formatted the rendered string, produced by {@link ReceiptMoneyFormatter} and by nothing
 *                  else
 */
public record ReceiptAmount(long paisa, String formatted) {

    public ReceiptAmount {
        Objects.requireNonNull(formatted, "formatted must not be null; use ReceiptAmount.of(paisa)");
    }

    /**
     * Build an amount from paisa using the one formatter. This is how every {@code ReceiptAmount}
     * in the product should be constructed — the canonical constructor stays public only because
     * Jackson needs it to read a document back off the wire.
     */
    public static ReceiptAmount of(long paisa) {
        return new ReceiptAmount(paisa, ReceiptMoneyFormatter.format(paisa));
    }

    /** As {@link #of(long)}, with the branch's currency prefix supplied explicitly. */
    public static ReceiptAmount of(long paisa, String currencyPrefix) {
        return new ReceiptAmount(paisa, ReceiptMoneyFormatter.format(paisa, currencyPrefix));
    }

    /** Zero, rendered as a visible zero — a tender row of nothing still prints a number. */
    public static ReceiptAmount zero() {
        return of(0L);
    }
}
