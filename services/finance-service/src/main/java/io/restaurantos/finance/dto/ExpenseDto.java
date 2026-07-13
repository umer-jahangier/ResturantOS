package io.restaurantos.finance.dto;

import io.restaurantos.finance.domain.enums.ExpenseStatus;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record ExpenseDto(
        UUID id,
        UUID branchId,
        LocalDate expenseDate,
        String expenseAccountCode,
        String description,
        long amountPaisa,
        ExpenseStatus status,
        UUID requestedBy,
        UUID approvedBy,
        Instant approvedAt,
        String rejectReason
) {}
