package io.restaurantos.pos.dto;

import io.restaurantos.pos.domain.enums.DerivedOrderStatus;
import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.PaymentStatus;

import java.time.Instant;
import java.util.UUID;

/**
 * Order Management list row (POS-09). Plain, service-constructed record — no {@code from()}
 * factory (mirrors {@link MenuCategoryDto}'s shape, not {@link DiningTableDto}'s), since
 * building it requires joining table-name data the entity alone doesn't carry.
 *
 * POS-24: extended with settlement + payment + item-quantity data so Order Management can
 * show closed/paid orders, a payment-status badge, and an item-quantity column without a
 * second round trip per row. {@code settlementStatus} is the raw {@link OrderStatus} (distinct
 * from {@code derivedStatus}'s kitchen-progress meaning); {@code paymentStatus}/
 * {@code amountPaidPaisa} are server-derived via {@link io.restaurantos.pos.service.PaymentStatusDerivationService}
 * and a batched payment-sum lookup (no N+1); {@code itemQuantity}/{@code distinctItemCount}
 * exclude CANCELLED lines.
 */
public record OrderSummaryDto(
        UUID orderId,
        String orderNo,
        UUID tableId,
        String tableName,
        DerivedOrderStatus derivedStatus,
        UUID cashierId,
        int coverCount,
        long totalPaisa,
        Instant openedAt,
        OrderStatus settlementStatus,
        PaymentStatus paymentStatus,
        long amountPaidPaisa,
        int itemQuantity,
        int distinctItemCount
) {}
