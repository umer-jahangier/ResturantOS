package io.restaurantos.pos.dto;

import io.restaurantos.pos.domain.enums.DerivedOrderStatus;
import io.restaurantos.pos.domain.enums.OrderItemStatus;
import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.OrderType;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record OrderDto(
        UUID id,
        UUID branchId,
        String orderNo,
        OrderType type,
        OrderStatus status,
        DerivedOrderStatus derivedStatus,
        UUID tableId,
        int coverCount,
        UUID cashierId,
        UUID customerId,
        long subtotalPaisa,
        long taxPaisa,
        long discountPaisa,
        long serviceChargePaisa,

        /**
         * The service-charge SNAPSHOT (F20): the rate this check was charged at and the branch's
         * own wording for it.
         *
         * <p>On the wire so the charge screen can say <em>"Service charge (5%)"</em> rather than a
         * bare amount, and so it can tell "this branch takes no service charge" apart from "this
         * branch takes 5% and the bill happens to be zero". {@code serviceChargePct} of 0 with
         * {@code serviceChargeLabel} null is the first case, and readers must then render NO
         * service-charge line at all — the {@code Service charge Rs 0.00} that printed on every
         * bill in the product's life is what this field exists to remove.
         */
        java.math.BigDecimal serviceChargePct,
        String serviceChargeLabel,

        long totalPaisa,
        String notes,
        Instant openedAt,
        Instant sentToKdsAt,
        UUID clientOrderId,
        long version,
        List<OrderItemDto> items,

        /**
         * Every discount on this check, individually (B3).
         *
         * <p>{@code discountPaisa} above is their sum and is all the bill needs. This list is
         * what makes the discount <em>reviewable</em>: without it the charge page could show
         * "Discounts Rs 99.80" and nobody — not the cashier, not the manager standing behind
         * them, not the owner the next morning — could see what that 99.80 was for or who
         * authorised it. Empty on the overwhelming majority of checks.
         */
        List<OrderDiscountDto> discounts
) {
    // Wire field kept named kdsStatus (type OrderItemStatus, the 7-value lifecycle) rather
    // than renamed to itemStatus — plan 07.1-01's decision, avoiding a second JSON-contract
    // break this cycle; the frontend enum-value/name update is deferred (PATTERNS.md).
    public record OrderItemDto(
            UUID id,
            UUID menuItemId,
            String itemNameSnapshot,
            long unitPriceSnapshot,
            int quantity,
            String kdsStation,
            OrderItemStatus kdsStatus,
            int revisionNo,
            Instant firedAt,
            long discountPaisa,
            long taxPaisa,
            long lineTotalPaisa,
            String notes,
            List<ModifierDto> modifiers,

            /**
             * The tax SNAPSHOT this line was charged at (F16): the rate, the fiscal code, and the
             * human name of the class at the time of sale.
             *
             * <p>On the wire so the charge screen and the receipt say the same words as the cart
             * did, and so a reprint of an old bill still describes the rate the guest actually
             * paid rather than whatever the menu says today.
             *
             * <p>{@code taxRatePct} is {@code 0} with {@code taxPaisa > 0} only on lines written
             * before F16 — the tax is real, the rate was never recorded, and readers must render
             * that as unclassified rather than as 0%.
             */
            java.math.BigDecimal taxRatePct,
            String taxRateCode,
            String taxClassName
    ) {}

    public record ModifierDto(
            UUID id,
            UUID modifierId,
            String modifierNameSnapshot,
            long priceDeltaPaisa
    ) {}

    /**
     * One discount, with the two facts that make it auditable.
     *
     * @param scope           LINE or ORDER
     * @param orderItemId     which line, for a LINE discount; null for ORDER
     * @param itemName        that line's name, so a reader does not have to resolve an id
     * @param type            FLAT or PERCENT (PROMOTION for the automatic engine's own rows)
     * @param value           rupees for FLAT, percent for PERCENT — what was ASKED for
     * @param amountPaisa     what actually came off the bill, after capping — what was GIVEN
     * @param reason          why. Never blank on a row written since V22
     * @param appliedBy       user id of whoever applied it
     * @param appliedByName   their display name at the time, or null if it could not be resolved
     */
    public record OrderDiscountDto(
            UUID id,
            String scope,
            UUID orderItemId,
            String itemName,
            String type,
            java.math.BigDecimal value,
            long amountPaisa,
            String reason,
            UUID appliedBy,
            String appliedByName,
            Instant appliedAt
    ) {}
}
