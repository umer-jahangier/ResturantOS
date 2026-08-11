package io.restaurantos.pos.web;

import io.restaurantos.pos.domain.model.StationType;
import io.restaurantos.pos.dto.CreateStationRequest;
import io.restaurantos.pos.dto.StationDto;
import io.restaurantos.pos.dto.UpdateStationRequest;
import io.restaurantos.pos.service.StationService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * Admin CRUD for KDS stations (Phase 3). {@code branchId} is an explicit request parameter
 * (matching this service's existing controller convention) but is validated against the
 * caller's verified JWT branch inside the service (branch-isolation guard).
 */
@RestController
@RequestMapping("/api/v1/pos/stations")
@RequiresFeature("FEATURE_POS")
public class StationController {

    private final StationService stationService;

    public StationController(StationService stationService) {
        this.stationService = stationService;
    }

    @PreAuthorize("hasAnyAuthority('pos.menu.view','pos.kds.view')")
    @GetMapping
    public ResponseEntity<ApiResponse<List<StationDto>>> listStations(
            @RequestParam UUID branchId,
            @RequestParam(required = false) StationType stationType) {
        return ResponseEntity.ok(ApiResponse.ok(stationService.listStations(branchId, stationType)));
    }

    @PreAuthorize("hasAuthority('pos.menu.manage')")
    @PostMapping
    public ResponseEntity<ApiResponse<StationDto>> createStation(
            @RequestParam UUID branchId,
            @Valid @RequestBody CreateStationRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(stationService.createStation(branchId, request)));
    }

    @PreAuthorize("hasAuthority('pos.menu.manage')")
    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<StationDto>> updateStation(
            @PathVariable UUID id,
            @RequestParam UUID branchId,
            @Valid @RequestBody UpdateStationRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(stationService.updateStation(id, branchId, request)));
    }

    @PreAuthorize("hasAuthority('pos.menu.manage')")
    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<StationDto>> deactivateStation(
            @PathVariable UUID id,
            @RequestParam UUID branchId) {
        return ResponseEntity.ok(ApiResponse.ok(stationService.deactivateStation(id, branchId)));
    }
}
