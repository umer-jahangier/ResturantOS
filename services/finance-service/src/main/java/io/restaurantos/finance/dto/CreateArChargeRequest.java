package io.restaurantos.finance.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;
import java.util.UUID;

/** Manual "post a charge to a house account" path (catering invoice, phone order on account, month-end billing). */
public record CreateArChargeRequest(
        @NotNull UUID branchId,
        @NotNull UUID customerAccountId,
        @NotNull LocalDate txnDate,
        @Positive long amountPaisa,
        @Size(max = 20) String revenueAccountCode,
        @Size(max = 200) String reference,
        @Size(max = 500) String memo
) {}
