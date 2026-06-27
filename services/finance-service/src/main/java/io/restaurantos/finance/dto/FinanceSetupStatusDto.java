package io.restaurantos.finance.dto;

public record FinanceSetupStatusDto(
        long accountCount,
        long periodCount,
        boolean provisioned
) {}
