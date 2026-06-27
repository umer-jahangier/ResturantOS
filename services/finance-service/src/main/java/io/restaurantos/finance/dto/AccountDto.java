package io.restaurantos.finance.dto;

import io.restaurantos.finance.domain.enums.AccountType;

import java.util.UUID;

public record AccountDto(
        UUID id,
        String code,
        String name,
        AccountType accountType,
        String parentCode,
        boolean system,
        String systemTag,
        boolean active
) {}
