package io.restaurantos.finance.dto;

import io.restaurantos.finance.domain.enums.AccountType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record CreateAccountRequest(
        @NotBlank @Size(max = 20) String code,
        @NotBlank @Size(max = 120) String name,
        @NotNull AccountType accountType,
        @Size(max = 20) String parentCode
) {}
