package io.restaurantos.finance.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.UUID;

public record CreateCustomerAccountRequest(
        @NotNull UUID branchId,
        @NotBlank @Size(max = 30) String accountCode,
        @NotBlank @Size(max = 200) String name,
        @Size(max = 200) String contactName,
        @Size(max = 30) String contactPhone,
        @Size(max = 200) String contactEmail,
        @Min(0) long creditLimitPaisa,
        @Min(0) int paymentTermsDays,
        UUID crmCustomerId
) {}
