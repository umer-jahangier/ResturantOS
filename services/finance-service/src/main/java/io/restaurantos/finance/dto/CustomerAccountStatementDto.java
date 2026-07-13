package io.restaurantos.finance.dto;

import java.util.List;

public record CustomerAccountStatementDto(
        CustomerAccountDto account,
        long balancePaisa,
        List<ArTransactionDto> transactions
) {}
