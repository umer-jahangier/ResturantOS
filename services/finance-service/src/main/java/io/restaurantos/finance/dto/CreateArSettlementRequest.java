package io.restaurantos.finance.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;
import java.util.UUID;

/** A payment received against a house account's outstanding balance. */
public record CreateArSettlementRequest(
        @NotNull UUID branchId,
        @NotNull UUID customerAccountId,
        @NotNull LocalDate txnDate,
        @Positive long amountPaisa,
        @Size(max = 200) String reference,
        @Size(max = 500) String memo
) {}
