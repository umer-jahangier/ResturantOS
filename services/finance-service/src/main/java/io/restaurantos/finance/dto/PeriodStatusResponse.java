package io.restaurantos.finance.dto;

import io.restaurantos.finance.domain.enums.PeriodStatus;

import java.util.UUID;

/** Response for GET /internal/finance/periods/status. */
public record PeriodStatusResponse(
        UUID periodId,
        PeriodStatus status,
        int fiscalYear,
        int periodNo
) {}
