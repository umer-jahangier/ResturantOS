package io.restaurantos.pos.event;

import java.util.UUID;

/**
 * ORDER_VOIDED stays here: it is a two-party pos→kitchen contract with parity ITs on both ends and
 * no history of drift. ORDER_REFUNDED crosses into finance and crm and therefore lives in
 * {@code shared-lib} as {@code PosEventContract.OrderRefundedPayload}.
 */
public class PosVoidRefundPayloads {

    public record OrderVoidedPayload(
            UUID orderId,
            String reason,
            UUID voidedBy
    ) {}

    private PosVoidRefundPayloads() {}
}
