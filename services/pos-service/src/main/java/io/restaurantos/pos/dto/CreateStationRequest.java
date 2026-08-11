package io.restaurantos.pos.dto;

import io.restaurantos.pos.domain.model.StationType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Create a station under the caller's branch. {@code code} is the stable routing/WS key.
 *
 * <p>{@code stationType} is OPTIONAL and defaults server-side to {@link StationType#DEFAULT}. It is
 * deliberately not required: an existing caller that has never heard of station types — the POS
 * admin screen as it shipped, any script, the e2e fixtures — keeps working unchanged and gets the
 * behaviour it had before. Requiring it would have made this an additive change that breaks
 * every existing caller, which is not an additive change.
 *
 * <p>Typed as the enum rather than a String, so Jackson refuses an out-of-range value at
 * deserialisation with a 400 rather than letting it reach the CHECK constraint as a 500.
 */
public record CreateStationRequest(
        @NotBlank @Size(max = 50) String code,
        @NotBlank @Size(max = 100) String name,
        StationType stationType
) {
    /**
     * The pre-phase-28 shape: a code and a name, and no opinion about the type.
     *
     * <p>Kept as a real constructor rather than requiring every existing call site to append a
     * {@code null} — the point of an optional field is that a caller who does not know it exists
     * does not have to say so. Jackson does not use this one (record deserialisation binds to the
     * canonical constructor unless a secondary is annotated {@code @JsonCreator}), so the wire
     * contract is unaffected.
     */
    public CreateStationRequest(String code, String name) {
        this(code, name, null);
    }

    /** The requested type, or the default when the caller did not say. */
    public StationType typeOrDefault() {
        return stationType != null ? stationType : StationType.DEFAULT;
    }
}
