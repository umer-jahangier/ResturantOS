package io.restaurantos.pos.service;

import io.restaurantos.pos.dto.CreateStationRequest;
import io.restaurantos.pos.dto.StationDto;
import io.restaurantos.pos.dto.UpdateStationRequest;

import java.util.List;
import java.util.UUID;

/**
 * Admin CRUD for KDS stations (Phase 3). Every method is tenant + branch scoped and guarded
 * by {@code requireOwnBranch} (the Phase 1/2 branch-isolation pattern) — a client-supplied
 * branchId must equal the caller's verified JWT branch.
 */
public interface StationService {

    List<StationDto> listStations(UUID branchId);

    StationDto createStation(UUID branchId, CreateStationRequest request);

    StationDto updateStation(UUID id, UUID branchId, UpdateStationRequest request);

    /** Soft-deactivate (sets is_active=false) — never a hard delete, to keep historical FK refs valid. */
    StationDto deactivateStation(UUID id, UUID branchId);
}
