package io.restaurantos.finance.dto;

import io.restaurantos.finance.domain.enums.PeriodStatus;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record AccountingPeriodDto(
        UUID id,
        int fiscalYear,
        int periodNo,
        LocalDate startDate,
        LocalDate endDate,
        PeriodStatus status,
        UUID lockedBy,
        Instant lockedAt
) {}
