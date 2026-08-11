package io.restaurantos.pos.dto;

import io.restaurantos.pos.domain.model.Station;
import io.restaurantos.pos.domain.model.StationType;

import java.util.UUID;

/** Read model for a KDS station (Phase 3 admin CRUD; typed in phase 28). */
public record StationDto(
        UUID id,
        UUID branchId,
        String code,
        String name,
        boolean active,
        StationType stationType,
        /**
         * Which physical screen this station's tickets belong on, derived from the type.
         *
         * <p>Sent alongside the type rather than left for the client to derive. The mapping from
         * five types to three display families lives on {@link StationType} and a second copy in
         * the browser would be a second answer to "does a dessert go to the kitchen screen" — and
         * the two would disagree the first time a value was added.
         */
        StationType.DisplayFamily displayFamily
) {
    public static StationDto from(Station s) {
        StationType type = s.getStationType() != null ? s.getStationType() : StationType.DEFAULT;
        return new StationDto(s.getId(), s.getBranchId(), s.getCode(), s.getName(), s.isActive(),
                type, type.displayFamily());
    }
}
