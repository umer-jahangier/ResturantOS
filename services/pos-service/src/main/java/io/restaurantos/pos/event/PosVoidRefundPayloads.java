package io.restaurantos.pos.event;

import java.util.UUID;

public class PosVoidRefundPayloads {

    public record OrderVoidedPayload(
            UUID orderId,
            String reason,
            UUID voidedBy
    ) {}

    public record OrderRefundedPayload(
            UUID orderId,
            long refundPaisa,
            String reason,
            UUID refundedBy
    ) {}

    private PosVoidRefundPayloads() {}
}
