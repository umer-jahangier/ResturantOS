package io.restaurantos.finance.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateJeLineRequest(
        @NotBlank @Size(max = 20) String accountCode,
        String description,
        @Min(0) long debitPaisa,
        @Min(0) long creditPaisa
) {}
