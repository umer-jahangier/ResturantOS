package io.restaurantos.hr.controller;

import io.restaurantos.hr.entity.AttendanceQuarantineEntity;
import io.restaurantos.hr.entity.AttendanceQuarantineEntity.Status;
import io.restaurantos.hr.repository.AttendanceQuarantineRepository;
import io.restaurantos.hr.service.PunchIngestService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/** Attendance quarantine review. List gated hr.attendance.view; resolve gated hr.attendance.manage. */
@RestController
@RequestMapping("/api/v1/hr/attendance/quarantine")
public class QuarantineController {

    private final AttendanceQuarantineRepository quarantineRepository;
    private final PunchIngestService punchIngestService;
    private final TenantContext tenantContext;

    public QuarantineController(AttendanceQuarantineRepository quarantineRepository,
                               PunchIngestService punchIngestService, TenantContext tenantContext) {
        this.quarantineRepository = quarantineRepository;
        this.punchIngestService = punchIngestService;
        this.tenantContext = tenantContext;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('hr.attendance.view')")
    public ApiResponse<List<AttendanceQuarantineEntity>> listPending() {
        UUID tenantId = tenantContext.getTenantId().orElseThrow(() -> new IllegalStateException("No tenant context"));
        return ApiResponse.ok(quarantineRepository.findAllByTenantIdAndStatus(tenantId, Status.PENDING));
    }

    @PostMapping("/{id}/resolve")
    @PreAuthorize("hasAuthority('hr.attendance.manage')")
    public ApiResponse<Void> resolve(@PathVariable UUID id, @RequestParam UUID employeeId) {
        punchIngestService.resolveQuarantine(id, employeeId);
        return ApiResponse.ok(null);
    }
}
