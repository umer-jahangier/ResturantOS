package io.restaurantos.pos.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Update a station's display name and/or active flag. {@code code} is immutable (it is the
 * stable routing/WS key) — a rename of the routing key would orphan in-flight tickets, so it
 * is intentionally not editable here.
 */
public record UpdateStationRequest(
        @NotBlank @Size(max = 100) String name,
        boolean active
) {}
