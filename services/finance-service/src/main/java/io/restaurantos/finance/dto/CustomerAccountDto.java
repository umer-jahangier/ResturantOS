package io.restaurantos.finance.dto;

import io.restaurantos.finance.domain.enums.CustomerAccountStatus;

import java.util.UUID;

public record CustomerAccountDto(
        UUID id,
        UUID branchId,
        String accountCode,
        String name,
        String contactName,
        String contactPhone,
        String contactEmail,
        long creditLimitPaisa,
        int paymentTermsDays,
        CustomerAccountStatus status,
        UUID crmCustomerId,
        long balancePaisa
) {}
