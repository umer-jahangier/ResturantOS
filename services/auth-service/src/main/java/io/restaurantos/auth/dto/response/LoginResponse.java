package io.restaurantos.auth.dto.response;

import java.util.UUID;

public record LoginResponse(
    String accessToken,
    long expiresInSeconds,
    UUID userId,
    UUID tenantId,
    UUID branchId
) {}
