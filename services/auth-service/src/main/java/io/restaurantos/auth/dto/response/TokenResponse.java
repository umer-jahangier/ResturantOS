package io.restaurantos.auth.dto.response;

public record TokenResponse(
    String accessToken,
    long expiresInSeconds
) {}
