package io.restaurantos.reporting.controller;

import io.restaurantos.reporting.dto.DashboardTileDto;
import io.restaurantos.reporting.service.DashboardTileService;
import io.restaurantos.reporting.support.BranchTimeZoneResolver;
import io.restaurantos.reporting.support.BusinessDay;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

/**
 * REST snapshot for the realtime dashboard (12-06) — {@code GET
 * /api/v1/reporting/dashboard/{branchId}/tiles} exists so a freshly-connected WebSocket client is
 * not blank until the next ORDER_CLOSED/TILL_CLOSED. Serves the SAME Redis-cached tiles
 * {@link DashboardTileService} pushes over the socket. {@code tenantId} is server-derived
 * (never a request field — 10-10-B precedent); {@code reporting.dashboard.view} is seeded and
 * granted by 12-11 (wave 1, already landed).
 */
@RestController
@RequestMapping("/api/v1/reporting/dashboard")
public class DashboardController {

    private final DashboardTileService dashboardTileService;
    private final TenantContext tenantContext;
    private final BranchTimeZoneResolver branchTimeZoneResolver;
    private final BusinessDay businessDay;

    public DashboardController(DashboardTileService dashboardTileService,
                                TenantContext tenantContext,
                                BranchTimeZoneResolver branchTimeZoneResolver,
                                BusinessDay businessDay) {
        this.dashboardTileService = dashboardTileService;
        this.tenantContext = tenantContext;
        this.branchTimeZoneResolver = branchTimeZoneResolver;
        this.businessDay = businessDay;
    }

    @GetMapping("/{branchId}/tiles")
    @PreAuthorize("hasAuthority('reporting.dashboard.view')")
    public ApiResponse<List<DashboardTileDto>> tiles(@PathVariable UUID branchId) {
        UUID tenantId = tenantContext.requireTenantId();
        ZoneId zone = branchTimeZoneResolver.resolve(branchId);
        LocalDate businessDate = businessDay.businessDate(Instant.now(), zone);
        return ApiResponse.ok(dashboardTileService.computeTiles(tenantId, branchId, businessDate));
    }
}
