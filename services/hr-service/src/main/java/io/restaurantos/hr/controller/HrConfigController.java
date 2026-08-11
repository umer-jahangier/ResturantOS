package io.restaurantos.hr.controller;

import io.restaurantos.hr.dto.HrConfigDtos.CreateDepartmentRequest;
import io.restaurantos.hr.dto.HrConfigDtos.CreateDesignationRequest;
import io.restaurantos.hr.dto.HrConfigDtos.DepartmentResponse;
import io.restaurantos.hr.dto.HrConfigDtos.DesignationResponse;
import io.restaurantos.hr.dto.HrConfigDtos.RenameDepartmentRequest;
import io.restaurantos.hr.dto.HrConfigDtos.RenameDesignationRequest;
import io.restaurantos.hr.service.HrConfigService;
import io.restaurantos.shared.api.ApiResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * The tenant-managed department and designation lists (D-35-05: HR is operable without SQL).
 *
 * <h2>There is deliberately NO delete endpoint</h2>
 *
 * <p>Not an oversight, and please do not add one for symmetry. A department referenced by an
 * employee cannot be deleted without either orphaning that employee or silently rewriting their
 * record. Deactivation keeps the row resolvable by id — so an existing employee still renders with
 * a real department name — while removing it from the list of assignable options. That is what an
 * owner actually wants when they say "we do not have that department any more".
 *
 * <h2>Reads are gated on view, writes on manage</h2>
 *
 * <p>Both codes exist so a manager filling in an employee form can READ the options without being
 * able to edit the tax table. Gating the list on {@code hr.config.manage} would empty the dropdown
 * for exactly the people who use it most.
 *
 * <p>OPA is asked inside {@link HrConfigService} as well. The {@code @PreAuthorize} here is the
 * coarse RBAC gate; the policy call is what applies tenant scoping. Neither replaces the other.
 */
@RestController
@RequestMapping("/api/v1/hr/config")
public class HrConfigController {

    private final HrConfigService hrConfigService;

    public HrConfigController(HrConfigService hrConfigService) {
        this.hrConfigService = hrConfigService;
    }

    // ── departments ──────────────────────────────────────────────────────────

    @GetMapping("/departments")
    @PreAuthorize("hasAuthority('hr.config.view')")
    public ApiResponse<List<DepartmentResponse>> listDepartments() {
        return ApiResponse.ok(hrConfigService.listDepartments());
    }

    @PostMapping("/departments")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('hr.config.manage')")
    public ApiResponse<DepartmentResponse> createDepartment(
            @Valid @RequestBody CreateDepartmentRequest req) {
        return ApiResponse.ok(hrConfigService.createDepartment(req));
    }

    @PutMapping("/departments/{id}")
    @PreAuthorize("hasAuthority('hr.config.manage')")
    public ApiResponse<DepartmentResponse> renameDepartment(
            @PathVariable UUID id, @Valid @RequestBody RenameDepartmentRequest req) {
        return ApiResponse.ok(hrConfigService.renameDepartment(id, req));
    }

    @PutMapping("/departments/{id}/active")
    @PreAuthorize("hasAuthority('hr.config.manage')")
    public ApiResponse<DepartmentResponse> setDepartmentActive(
            @PathVariable UUID id, @Valid @RequestBody ActiveRequest req) {
        return ApiResponse.ok(hrConfigService.setDepartmentActive(id, req.active()));
    }

    // ── designations ─────────────────────────────────────────────────────────

    @GetMapping("/designations")
    @PreAuthorize("hasAuthority('hr.config.view')")
    public ApiResponse<List<DesignationResponse>> listDesignations() {
        return ApiResponse.ok(hrConfigService.listDesignations());
    }

    @PostMapping("/designations")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('hr.config.manage')")
    public ApiResponse<DesignationResponse> createDesignation(
            @Valid @RequestBody CreateDesignationRequest req) {
        return ApiResponse.ok(hrConfigService.createDesignation(req));
    }

    @PutMapping("/designations/{id}")
    @PreAuthorize("hasAuthority('hr.config.manage')")
    public ApiResponse<DesignationResponse> renameDesignation(
            @PathVariable UUID id, @Valid @RequestBody RenameDesignationRequest req) {
        return ApiResponse.ok(hrConfigService.renameDesignation(id, req));
    }

    @PutMapping("/designations/{id}/active")
    @PreAuthorize("hasAuthority('hr.config.manage')")
    public ApiResponse<DesignationResponse> setDesignationActive(
            @PathVariable UUID id, @Valid @RequestBody ActiveRequest req) {
        return ApiResponse.ok(hrConfigService.setDesignationActive(id, req.active()));
    }

    /** A body rather than a path segment, so reactivating is the same endpoint as deactivating. */
    public record ActiveRequest(boolean active) {
    }
}
