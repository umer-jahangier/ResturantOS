package io.restaurantos.platform.controller;

import io.restaurantos.platform.dto.SystemHealthDtos.SystemHealthResponse;
import io.restaurantos.platform.service.SystemHealthService;
import io.restaurantos.shared.api.ApiResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The SuperAdmin system status surface.
 *
 * <p>One route, one read, no cache. A status page served from a cache is a status page reporting
 * the past, and the moment it matters is the moment the past is wrong. Every probe below is made
 * when the request arrives, with a short per-probe timeout so that the page returns during the
 * incident it is being read for.
 *
 * <p>Not to be confused with {@code /actuator/health}, which is this service's own liveness and is
 * {@code permitAll()}. This is the FLEET's health, it crosses every service boundary, and it is
 * gated on {@code SUPER_ADMIN} accordingly.
 */
@RestController
@RequestMapping("/api/v1/platform/system")
@PreAuthorize("hasAuthority('SUPER_ADMIN')")
public class PlatformSystemController {

    private final SystemHealthService systemHealthService;

    public PlatformSystemController(SystemHealthService systemHealthService) {
        this.systemHealthService = systemHealthService;
    }

    /**
     * {@code GET /api/v1/platform/system/health}
     *
     * <p>Registry, per-service actuator health with per-instance detail, platform database, cache,
     * broker, Liquibase state, the ClickHouse fact-table precondition that reporting-service refuses
     * to boot without — and an explicit list of the metrics this platform does not collect at all.
     *
     * <p>Always 200 when the caller is entitled to read it, including when the fleet is on fire: the
     * failures are IN the document. A status endpoint that returns 503 when a dependency is down
     * cannot tell you which one.
     */
    @GetMapping("/health")
    public ResponseEntity<ApiResponse<SystemHealthResponse>> health() {
        return ResponseEntity.ok(ApiResponse.ok(systemHealthService.health()));
    }
}
