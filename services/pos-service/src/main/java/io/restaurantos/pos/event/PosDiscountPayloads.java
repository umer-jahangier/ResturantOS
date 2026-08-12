package io.restaurantos.pos.event;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Giving money away, as a record somebody outside the building can read (D-2).
 *
 * <h2>The gap this closes</h2>
 *
 * <p>The audit vocabulary had 27 actions and <b>none</b> of them mentioned discount, comp, price or
 * override. Measured 2026-08-12 by reading every option off the live {@code #audit-action} select
 * and filtering on the word: zero. {@code ORDER_DISCOUNT_APPLIED} and {@code ORDER_DISCOUNTED} both
 * returned {@code 200} with {@code n=0}.
 *
 * <p>So a manager could take 10% off any check in the building, or comp a line, and the only record
 * was a row inside the order itself — visible to someone who already knew which order to open. The
 * audit screen promises "Every sign-in, void, refund, till session, role change and journal posting
 * in this business, with who did it and when", and could not show an owner who was not on the floor
 * that money was being given away. Until B3 a discount could not be given at all, so the gap did
 * not exist; it exists now, and it is the largest trust gap in the product.
 *
 * <h2>Why these live here and not in shared-lib</h2>
 *
 * <p>Same rule {@link PosVoidRefundPayloads} states for {@code ORDER_VOIDED}: a payload that
 * crosses into finance or crm belongs in {@code shared-lib} where both ends can compile against it.
 * These cross into audit-service only, which deserialises every payload generically as a map and
 * compiles against nothing. Promoting them to a shared contract would advertise a coupling that
 * does not exist.
 *
 * <h2>What the fields are for</h2>
 *
 * <p>Enough to answer the question an owner actually asks — "who gave away what, on which check,
 * and why" — without opening the order. {@code amountPaisa} is the money that really came off after
 * the server's clamp, not the figure that was typed; {@code value} beside it is what was typed, and
 * the two differ whenever a discount was capped. {@code orderTotalPaisa} is the bill AFTERWARDS, so
 * a reader can see the size of the concession against the size of the check without a second query.
 *
 * <p>The actor is NOT a field. It travels in the envelope, stamped by {@code DomainEventPublisher}
 * from the verified JWT — {@code AuditIngestionService.resolveActor} reads it from there, and a
 * payload-carried actor is the thing that class documents as having produced audit rows that could
 * not say who did it.
 */
public final class PosDiscountPayloads {

    /**
     * A discount was given.
     *
     * @param orderItemId the line it came off, or null when the discount is on the whole check
     * @param itemName    that line's name as the guest sees it, so the log reads without a join
     * @param value       what the operator typed — percent for PERCENT, rupees for FLAT
     * @param amountPaisa what actually came off, after the clamp against remaining headroom
     * @param orderTotalPaisa what the check came to once the discount was priced in
     */
    public record OrderDiscountAppliedPayload(
            UUID orderId,
            String orderNo,
            String scope,
            UUID orderItemId,
            String itemName,
            String type,
            BigDecimal value,
            long amountPaisa,
            long orderTotalPaisa,
            String reason
    ) {}

    /**
     * A discount stopped applying to a check.
     *
     * <p><b>There is no "remove a discount" button, and this is not one.</b> The only way a
     * discount is currently withdrawn is {@code applyDiscount}'s replace-never-stack rule: a second
     * manual discount at the same scope displaces the first. That displacement moves real money —
     * replacing "Rs 500 off" with "10% off" hands the guest back Rs 400 — and before this event it
     * left no trace anywhere except the disappearance of a row.
     *
     * <p>It is emitted per displaced row, immediately before the replacement's
     * {@code ORDER_DISCOUNT_APPLIED}, so the pair reads as the correction it is. If a delete
     * endpoint is ever added it should publish this same type rather than inventing another.
     *
     * @param amountPaisa the money that had been coming off and now is not
     */
    public record OrderDiscountRemovedPayload(
            UUID orderId,
            String orderNo,
            String scope,
            UUID orderItemId,
            String type,
            BigDecimal value,
            long amountPaisa,
            String reason,
            /** Why it stopped applying. Today always the replace-never-stack rule. */
            String removedBecause
    ) {}

    private PosDiscountPayloads() {}
}
