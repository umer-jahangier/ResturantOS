package io.restaurantos.pos.dto;

import io.restaurantos.pos.domain.model.StationType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Update a station's display name, type and/or active flag. {@code code} is immutable (it is the
 * stable routing/WS key) — a rename of the routing key would orphan in-flight tickets, so it
 * is intentionally not editable here.
 *
 * <p>{@code stationType} is optional for the same reason it is optional on create: an existing
 * caller that sends only {@code name} and {@code active} must not silently reset the station's
 * type. Absent means "leave it alone", not "make it KITCHEN".
 */
public record UpdateStationRequest(
        @NotBlank @Size(max = 100) String name,
        boolean active,
        StationType stationType
) {
    /**
     * The pre-phase-28 shape: rename and/or retire, with no opinion about the type.
     *
     * <p>A null type means "leave it alone", so this constructor is not a partial update that
     * silently resets anything. See the record javadoc.
     */
    public UpdateStationRequest(String name, boolean active) {
        this(name, active, null);
    }
}
