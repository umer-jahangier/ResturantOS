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
     * Enqueue an already-assembled kitchen ticket for the print agent (26-07).
     *
     * <p>This exists so there is exactly ONE write path into {@code print_jobs}. Sequence
     * allocation, the pessimistic slot lock and the document stamping are the same code the
     * issuance path uses; only the status and the revision differ.
     *
     * <p><b>Runs in a NEW transaction.</b> Dispatch enqueues one ticket per station, and a
     * constraint breach on one station must not roll back a sibling station's row — the hot pass
     * duplicating is not a reason for the cold pass to go unprinted.
     *
     * @param revisionNo the order-item revision this ticket is for. Together with
     *                   {@code targetPrinterId} it is the after-commit dispatch's idempotency key,
     *                   enforced by {@code uq_print_jobs_revision}: a retried dispatch of the same
     *                   revision to the same station is refused by the database, not by a guess.
     * @param status     {@code QUEUED} when routed, {@code FAILED} when the station has no printer
     * @param lastError  null when routed; names the station otherwise
     */
    UUID enqueueKitchenTicket(UUID orderId, UUID branchId, String targetPrinterId, int revisionNo,
                              PrintDocument document, io.restaurantos.pos.domain.enums.PrintJobStatus status,
                              String lastError);

    /**
     * Enqueue the customer receipt for the print agent on close.
     *
     * <p>Identical to {@link #issue} in every respect except the status it lands in: the agent will
     * claim it, so it starts {@code QUEUED} rather than {@code ISSUED}. A branch with no receipt
     * printer never reaches here — {@code PrintDispatchService} enqueues nothing at all for it.
     */
    IssuedDocument enqueueReceipt(UUID orderId, UUID branchId, String idempotencyKey);

    /**
     * @param printJobId the row this issue is recorded on
     * @param document   the document to render; for a reprint, the first issue's body with new
     *                   issue metadata stamped on it
     */
    record IssuedDocument(UUID printJobId, String targetPrinterId, PrintDocument document) {}
}
