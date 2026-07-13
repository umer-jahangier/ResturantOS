package io.restaurantos.finance.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;
import java.util.UUID;

public record CreateExpenseRequest(
        @NotNull UUID branchId,
        @NotNull LocalDate expenseDate,
        @NotBlank @Size(max = 20) String expenseAccountCode,
        @Size(max = 500) String description,
        @Positive long amountPaisa
) {}
