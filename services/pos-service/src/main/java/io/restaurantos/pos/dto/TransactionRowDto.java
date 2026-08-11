package io.restaurantos.pos.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * One row of the transaction register (37-08, D-37-01).
 *
 * <h2>THE GRAIN: a row is a MONEY EVENT, not an order</h2>
 *
 * <p>An order settled half in cash and half by card is TWO rows. This is deliberate and it is the
 * central design decision of the register. The question an owner actually asks is "what came in by
 * card today", and an order-grain register cannot answer it without the caller doing arithmetic the
 * product should have done — and doing it wrong, because a split-tender order belongs partly to two
 * different answers.
 *
 * <p>{@link #eventKind} is an explicit discriminator so a renderer never has to infer what a row is
 * from which fields happen to be populated.
 *
 * <h2>The order's totals ride along, and are NOT the row's</h2>
 *
 * <p>Every {@code order*Paisa} field below belongs to the ORDER, not to this row, and is present
 * only for context — so a card row can show "this was part of a Rs 3,364 bill". <b>Summing them
 * across rows double-counts every split-tender order.</b> The field names carry the {@code order}
 * prefix for exactly that reason. The only summable money on this row is
 * {@link #eventAmountPaisa}.
 *
 * <h2>Terminal</h2>
 *
 * <p>There is no terminal column in this schema. {@code orders} carries {@code till_session_id} and
 * {@code cashier_id} and nothing that identifies a physical terminal, so the register attributes by
 * till session rather than pretending to a terminal id it does not have.
 */
public record TransactionRowDto(
        /** TENDER, REFUND or VOID — never inferred from which fields are populated. */
        EventKind eventKind,
        /** When the money moved: the payment's recorded_at, the refund's created_at, or voided_at. */
        Instant eventAt,

        UUID orderId,
        String orderNo,
        UUID branchId,
        UUID cashierId,
        UUID tillSessionId,

        /** Populated on a TENDER row only. */
        String tenderMethod,
        /**
         * The amount THIS event moved, in paisa. Positive for a tender, negative for a refund, and
         * the order total negated for a void. This is the ONLY summable money column on the row.
         */
        long eventAmountPaisa,
        /** Populated on a REFUND row (the reason given) or a VOID row (the void reason). */
        String reason,

        // ── The ORDER's own figures. Context only. Do NOT sum these across rows. ──────────────
        String orderStatus,
        long orderSubtotalPaisa,
        long orderDiscountPaisa,
        long orderTaxPaisa,
        long orderServiceChargePaisa,
        long orderTotalPaisa
) {
    public enum EventKind { TENDER, REFUND, VOID }
}
