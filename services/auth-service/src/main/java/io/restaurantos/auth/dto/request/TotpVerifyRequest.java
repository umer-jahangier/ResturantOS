package io.restaurantos.auth.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record TotpVerifyRequest(
    @NotBlank @Pattern(regexp = "\\d{6}") String code
) {}
