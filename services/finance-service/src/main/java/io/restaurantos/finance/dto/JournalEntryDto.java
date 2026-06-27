package io.restaurantos.finance.dto;

import io.restaurantos.finance.domain.enums.JeStatus;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public record JournalEntryDto(
        UUID id,
        String entryNo,
        UUID periodId,
        LocalDate entryDate,
        String description,
        String sourceType,
        UUID sourceId,
        JeStatus status,
        UUID postedBy,
        boolean reversal,
        UUID reversalOfJe,
        UUID reversedByJe,
        long totalDebitPaisa,
        long totalCreditPaisa,
        List<JournalLineDto> lines
) {}
