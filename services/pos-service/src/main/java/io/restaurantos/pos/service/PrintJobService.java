package io.restaurantos.pos.service;

import io.restaurantos.shared.print.PrintDocument;

import java.util.UUID;

/**
 * Issuing a document and re-serving one that was already issued.
 *
 * <h2>Why a reprint is a READ of stored bytes</h2>
 *
 * <p>{@link #issue} calls the assembler for the FIRST issue of a routing slot and never again.
 * Every later issue copies the stored body and stamps new issue metadata. That is what makes
 * definition-of-done item 3 provable: the two documents are identical because they are the same
 * bytes, not because two runs of an assembler happened to agree. Re-assembling would let a later
 * price edit, a refund, or a menu-item rename change a document the customer is already holding.
 */
public interface PrintJobService {

    /**
     * Issue a document for an order, allocating the next sequence for its routing slot.
     *
     * <p>Writes a {@code print_jobs} row. NOT idempotent by nature — issuing twice is a legitimate
     * reprint — so a client that may retry passes {@code idempotencyKey} and gets the same row back
     * rather than inflating the reprint count.
     *
     * @param idempotencyKey nullable; when present, a replay returns the first result verbatim
     */
    IssuedDocument issue(UUID orderId, UUID branchId, String idempotencyKey);

    /** Re-serve a stored job's document verbatim. Allocates nothing and writes nothing. */
    IssuedDocument fetch(UUID printJobId);

    /**
     * @param printJobId the row this issue is recorded on
     * @param document   the document to render; for a reprint, the first issue's body with new
     *                   issue metadata stamped on it
     */
    record IssuedDocument(UUID printJobId, String targetPrinterId, PrintDocument document) {}
}
