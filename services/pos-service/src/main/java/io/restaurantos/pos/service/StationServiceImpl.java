package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.model.Station;
import io.restaurantos.pos.domain.model.StationType;
import io.restaurantos.pos.dto.CreateStationRequest;
import io.restaurantos.pos.dto.StationDto;
import io.restaurantos.pos.dto.UpdateStationRequest;
import io.restaurantos.pos.repository.StationRepository;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.exception.StateInvalidException;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class StationServiceImpl implements StationService {

    private final StationRepository stationRepository;
    private final TenantContext tenantContext;

    public StationServiceImpl(StationRepository stationRepository, TenantContext tenantContext) {
        this.stationRepository = stationRepository;
        this.tenantContext = tenantContext;
    }

    @Override
    @Transactional(readOnly = true)
    public List<StationDto> listStations(UUID branchId) {
        return listStations(branchId, null);
    }

    /**
     * The branch's stations, optionally narrowed to one type.
     *
     * <p>Unfiltered is the default and is byte-identical to what {@code listStations(branchId)} has
     * always returned, so the existing screen and every existing caller are unaffected.
     */
    @Override
    @Transactional(readOnly = true)
    public List<StationDto> listStations(UUID branchId, StationType stationType) {
        requireOwnBranch(branchId);
        UUID tenantId = tenantContext.requireTenantId();
        List<Station> stations = stationType != null
                ? stationRepository.findByTenantIdAndBranchIdAndStationType(tenantId, branchId, stationType)
                : stationRepository.findByTenantIdAndBranchId(tenantId, branchId);
        return stations.stream()
                .map(StationDto::from)
                .toList();
    }

    @Override
    @Transactional
    public StationDto createStation(UUID branchId, CreateStationRequest request) {
        requireOwnBranch(branchId);
        UUID tenantId = tenantContext.requireTenantId();

        // Uniqueness on (tenant_id, branch_id, code) — reject a duplicate up front with a clean
        // 409 rather than surfacing the DB constraint violation. The DB constraint still backstops
        // a race between two concurrent creates.
        stationRepository.findByTenantIdAndBranchIdAndCode(tenantId, branchId, request.code()).ifPresent(s -> {
            throw new StateInvalidException("Station code already exists for this branch: " + request.code());
        });

        Station station = new Station();
        station.setTenantId(tenantId);
        station.setBranchId(branchId);
        station.setCode(request.code());
        station.setName(request.name());
        station.setActive(true);
        // Optional on the request and defaulted here rather than required, so a caller that has
        // never heard of station types keeps the behaviour it had before phase 28 (D-28-01).
        station.setStationType(request.typeOrDefault());
        return StationDto.from(stationRepository.save(station));
    }

    @Override
    @Transactional
    public StationDto updateStation(UUID id, UUID branchId, UpdateStationRequest request) {
        requireOwnBranch(branchId);
        // Scope the lookup to the caller's branch so a cross-branch id cannot be mutated
        // (RLS is tenant-only — this guard is the branch boundary).
        Station station = stationRepository
                .findByIdAndTenantIdAndBranchId(id, tenantContext.requireTenantId(), branchId)
                .orElseThrow(() -> new ResourceNotFoundException("Station not found: " + id));
        station.setName(request.name());
        station.setActive(request.active());
        // Absent means "leave it alone", not "make it KITCHEN". A caller that sends only name and
        // active — every caller that predates this phase — must not silently reset the type.
        if (request.stationType() != null) {
            station.setStationType(request.stationType());
        }
        return StationDto.from(stationRepository.save(station));
    }

    @Override
    @Transactional
    public StationDto deactivateStation(UUID id, UUID branchId) {
        requireOwnBranch(branchId);
        Station station = stationRepository
                .findByIdAndTenantIdAndBranchId(id, tenantContext.requireTenantId(), branchId)
                .orElseThrow(() -> new ResourceNotFoundException("Station not found: " + id));
        station.setActive(false);
        return StationDto.from(stationRepository.save(station));
    }

    /**
     * Defense-in-depth against a client-supplied {@code branchId} that widens scope beyond the
     * caller's JWT branch. Mirrors {@code TableServiceImpl.requireOwnBranch} (Phase 1/2 pattern).
     */
    private void requireOwnBranch(UUID branchId) {
        UUID jwtBranchId = tenantContext.getBranchId()
                .orElseThrow(() -> new PermissionDeniedException("Branch context required"));
        if (!jwtBranchId.equals(branchId)) {
            throw new PermissionDeniedException("Cannot access stations for a different branch");
        }
    }
}
