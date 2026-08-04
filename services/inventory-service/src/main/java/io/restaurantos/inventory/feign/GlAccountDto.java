package io.restaurantos.inventory.feign;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.UUID;

/**
 * Inventory's view of a finance-service chart-of-accounts row, as returned by
 * {@code /internal/finance/accounts/**}. Mirrors {@code io.restaurantos.finance.dto.AccountDto};
 * the two services share no code, so this is a deliberate copy of the wire contract.
 *
 * <p>{@code ignoreUnknown} because this service's primary {@code ObjectMapper} is the strict one —
 * without it, finance adding a field to its own DTO would start failing every inventory category
 * save rather than being ignored.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record GlAccountDto(
        UUID id,
        String code,
        String name,
        String accountType,
        String parentCode,
        boolean system,
        String systemTag,
        boolean active) {}
