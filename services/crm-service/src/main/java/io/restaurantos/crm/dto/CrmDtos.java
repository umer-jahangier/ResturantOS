package io.restaurantos.crm.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public final class CrmDtos {

    private CrmDtos() {}

    public record CreateCustomerRequest(
            @NotBlank @Size(max = 30) String phone,
            @NotBlank @Size(max = 200) String name,
            String email,
            LocalDate birthday
    ) {}

    public record UpdateCustomerRequest(
            @Size(max = 200) String name,
            String email,
            LocalDate birthday
    ) {}

    public record CustomerResponse(
            UUID id,
            String phone,
            String name,
            String email,
            LocalDate birthday
    ) {}

    public record CustomerLookupResponse(
            UUID customerId,
            String name,
            String tier,
            long pointsBalance
    ) {}

    public record EvaluatePromotionRequest(
            UUID branchId,
            UUID customerId,
            long subtotalPaisa,
            Instant at,
            List<OrderItemLine> items
    ) {
        public record OrderItemLine(UUID menuItemId, long lineTotalPaisa) {}
    }

    public record EvaluatePromotionResponse(
            long discountPaisa,
            List<UUID> appliedPromotionIds
    ) {}

    public record CreatePromotionRequest(
            @NotBlank String name,
            @NotBlank String discountType,
            long discountValue,
            Instant startAt,
            Instant endAt,
            Integer[] daysOfWeek,
            Integer hourStart,
            Integer hourEnd,
            String[] tierFilter,
            UUID[] menuItemIds
    ) {}

    public record PromotionResponse(
            UUID id,
            String name,
            String discountType,
            long discountValue,
            Instant startAt,
            Instant endAt,
            boolean active
    ) {}

    public record SubmitFeedbackRequest(
            UUID customerId,
            UUID orderId,
            int rating,
            String comment
    ) {}

    public record FeedbackResponse(
            UUID id,
            UUID customerId,
            UUID orderId,
            int rating,
            String comment,
            Instant createdAt
    ) {}
}
