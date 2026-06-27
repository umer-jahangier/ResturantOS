package io.restaurantos.finance.dto;

public record GlBalanceDto(
        String accountCode,
        long totalDebitPaisa,
        long totalCreditPaisa,
        long netPaisa
) {}
