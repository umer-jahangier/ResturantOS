package io.restaurantos.authz.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record AuthorizeRequest(
    @NotBlank String module,
    @NotBlank String action,
    @NotNull Resource resource
) {
    public record Resource(
        String type,
        UUID id,
        @NotNull UUID tenantId,
        @NotNull UUID branchId,
        UUID createdBy,
        String status,
        Long amountPaisa
    ) {}
}
