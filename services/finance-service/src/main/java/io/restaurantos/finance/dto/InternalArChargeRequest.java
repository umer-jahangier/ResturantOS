package io.restaurantos.finance.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Phase 7 seam contract: body for POST /internal/finance/ar/charges. sourceType is always
 * POS_ORDER, sourceId is orderId — see InternalFinanceController.
 */
public record InternalArChargeRequest(
        @NotNull UUID branchId,
        @NotNull UUID customerAccountId,
        @NotNull UUID orderId,
        @NotNull LocalDate chargeDate,
        @Positive long amountPaisa,
        @Size(max = 200) String reference,
        @Size(max = 20) String revenueAccountCode
) {}
