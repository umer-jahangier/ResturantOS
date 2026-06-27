package io.restaurantos.finance.dto;

import jakarta.validation.constraints.NotNull;

public record ProvisionRequest(
        @NotNull Integer fiscalYear,
        String coaTemplate
) {}
