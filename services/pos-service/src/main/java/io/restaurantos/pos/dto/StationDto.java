package io.restaurantos.pos.dto;

import io.restaurantos.pos.domain.model.Station;

import java.util.UUID;

/** Read model for a KDS station (Phase 3 admin CRUD). */
public record StationDto(
        UUID id,
        UUID branchId,
        String code,
        String name,
        boolean active
) {
    public static StationDto from(Station s) {
        return new StationDto(s.getId(), s.getBranchId(), s.getCode(), s.getName(), s.isActive());
    }
}
