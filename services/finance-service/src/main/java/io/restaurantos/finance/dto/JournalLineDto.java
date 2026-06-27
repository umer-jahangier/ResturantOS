package io.restaurantos.finance.dto;

import java.util.UUID;

public record JournalLineDto(
        UUID id,
        String accountCode,
        String description,
        long debitPaisa,
        long creditPaisa
) {}
