package io.restaurantos.finance.dto;

public record GlBalanceDto(
        String accountCode,
        String accountName,
        long debitTotal,
        long creditTotal,
        long netBalance
) {}
