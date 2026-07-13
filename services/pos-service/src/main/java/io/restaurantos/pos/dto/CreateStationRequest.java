package io.restaurantos.pos.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Create a station under the caller's branch. {@code code} is the stable routing/WS key. */
public record CreateStationRequest(
        @NotBlank @Size(max = 50) String code,
        @NotBlank @Size(max = 100) String name
) {}
