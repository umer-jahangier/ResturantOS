package io.restaurantos.hr.service;

import io.restaurantos.hr.authz.HrAuthorizationService;
import io.restaurantos.hr.dto.HrConfigDtos.CreateDepartmentRequest;
import io.restaurantos.hr.dto.HrConfigDtos.CreateDesignationRequest;
import io.restaurantos.hr.dto.HrConfigDtos.DepartmentResponse;
import io.restaurantos.hr.dto.HrConfigDtos.DesignationResponse;
import io.restaurantos.hr.dto.HrConfigDtos.RenameDepartmentRequest;
import io.restaurantos.hr.dto.HrConfigDtos.RenameDesignationRequest;
import io.restaurantos.hr.entity.DepartmentEntity;
import io.restaurantos.hr.entity.DesignationEntity;
import io.restaurantos.hr.repository.DepartmentRepository;
import io.restaurantos.hr.repository.DesignationRepository;
import io.restaurantos.shared.exception.DuplicateValueException;
import io.restaurantos.shared.exception.FieldValidationException;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * The tenant-managed department and designation lists (D-35-01, D-35-05).
 *
 * <h2>Why these are rows and not strings</h2>
 *
 * {@code employees.department} and {@code employees.designation} were TEXT, so the Employees screen
 * offered two text boxes and the user's complaint followed directly: "Waiter", "waiter" and "Wtr"
 * became three departments and no report could group them.
 *
 * <h2>Authorization</h2>
 *
 * Every method asks OPA first, through {@link HrAuthorizationService}. Reads need
 * {@code hr.config.view}, writes {@code hr.config.manage}. Gating the LIST on manage would empty
 * the dropdown for exactly the people who use it most — a manager filling in an employee form.
 *
 * <h2>Deactivate, never delete</h2>
 *
 * There is no delete operation here and no delete endpoint on the controller. A department
 * referenced by an employee cannot be removed without either orphaning the employee or rewriting
 * their record, and both are worse than an inactive flag.
 */
@Service
public class HrConfigService {

    private final DepartmentRepository departmentRepository;
    private final DesignationRepository designationRepository;
    private final TenantContext tenantContext;
    private final HrAuthorizationService authorization;

    public HrConfigService(DepartmentRepository departmentRepository,
                           DesignationRepository designationRepository,
                           TenantContext tenantContext,
                           HrAuthorizationService authorization) {
        this.departmentRepository = departmentRepository;
        this.designationRepository = designationRepository;
        this.tenantContext = tenantContext;
        this.authorization = authorization;
    }

    // ── departments ──────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<DepartmentResponse> listDepartments() {
        UUID tenantId = requireTenant();
        authorization.authorizeConfigView(tenantId);
        return departmentRepository.findAllByTenantIdOrderByNameAsc(tenantId).stream()
                .map(HrConfigService::toDepartment).toList();
    }

    @Transactional
    public DepartmentResponse createDepartment(CreateDepartmentRequest req) {
        UUID tenantId = requireTenant();
        authorization.authorizeConfigManage(tenantId);
        requireDepartmentNameFree(tenantId, req.name(), null);

        DepartmentEntity d = new DepartmentEntity();
        d.setTenantId(tenantId);
        d.setName(req.name().trim());
        d.setCode(blankToNull(req.code()));
        d.setCreatedBy(tenantContext.getUserId().orElse(null));
        return toDepartment(departmentRepository.save(d));
    }

    @Transactional
    public DepartmentResponse renameDepartment(UUID id, RenameDepartmentRequest req) {
        UUID tenantId = requireTenant();
        authorization.authorizeConfigManage(tenantId);
        DepartmentEntity d = departmentRepository.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Department", id));
        requireDepartmentNameFree(tenantId, req.name(), id);

        d.setName(req.name().trim());
        d.setCode(blankToNull(req.code()));
        touch(d.getId(), d::setUpdatedAt, d::setUpdatedBy);
        return toDepartment(departmentRepository.save(d));
    }

    @Transactional
    public DepartmentResponse setDepartmentActive(UUID id, boolean active) {
        UUID tenantId = requireTenant();
        authorization.authorizeConfigManage(tenantId);
        DepartmentEntity d = departmentRepository.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Department", id));
        d.setActive(active);
        touch(d.getId(), d::setUpdatedAt, d::setUpdatedBy);
        return toDepartment(departmentRepository.save(d));
    }

    // ── designations ─────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<DesignationResponse> listDesignations() {
        UUID tenantId = requireTenant();
        authorization.authorizeConfigView(tenantId);
        return designationRepository.findAllByTenantIdOrderByNameAsc(tenantId).stream()
                .map(HrConfigService::toDesignation).toList();
    }

    @Transactional
    public DesignationResponse createDesignation(CreateDesignationRequest req) {
        UUID tenantId = requireTenant();
        authorization.authorizeConfigManage(tenantId);
        requireDesignationNameFree(tenantId, req.name(), null);
        requireParentDepartmentInTenant(tenantId, req.departmentId());

        DesignationEntity d = new DesignationEntity();
        d.setTenantId(tenantId);
        d.setName(req.name().trim());
        d.setCode(blankToNull(req.code()));
        d.setDepartmentId(req.departmentId());
        d.setCreatedBy(tenantContext.getUserId().orElse(null));
        return toDesignation(designationRepository.save(d));
    }

    @Transactional
    public DesignationResponse renameDesignation(UUID id, RenameDesignationRequest req) {
        UUID tenantId = requireTenant();
        authorization.authorizeConfigManage(tenantId);
        DesignationEntity d = designationRepository.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Designation", id));
        requireDesignationNameFree(tenantId, req.name(), id);
        requireParentDepartmentInTenant(tenantId, req.departmentId());

        d.setName(req.name().trim());
        d.setCode(blankToNull(req.code()));
        d.setDepartmentId(req.departmentId());
        touch(d.getId(), d::setUpdatedAt, d::setUpdatedBy);
        return toDesignation(designationRepository.save(d));
    }

    @Transactional
    public DesignationResponse setDesignationActive(UUID id, boolean active) {
        UUID tenantId = requireTenant();
        authorization.authorizeConfigManage(tenantId);
        DesignationEntity d = designationRepository.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Designation", id));
        d.setActive(active);
        touch(d.getId(), d::setUpdatedAt, d::setUpdatedBy);
        return toDesignation(designationRepository.save(d));
    }

    // ── guards ───────────────────────────────────────────────────────────────

    /**
     * Turns what the database would report as a bare 23505 into a message that NAMES THE FIELD.
     *
     * <p>The functional unique index is the real guarantee and it stays the last word — this check
     * races, and losing the race still produces a correct 409 through {@code handleDataIntegrity}.
     * What that fallback cannot do is say WHICH input to change, and a 409 with no field path
     * cannot be bound to a form control (D-35-03).
     */
    private void requireDepartmentNameFree(UUID tenantId, String name, UUID excludeId) {
        departmentRepository.findByNormalisedName(tenantId, name, excludeId).ifPresent(existing -> {
            throw new DuplicateValueException("name",
                    "A department called \"" + existing.getName() + "\" already exists."
                            + " Names are matched ignoring case and spacing, so \"" + name.trim()
                            + "\" would be the same department. Choose a different name.");
        });
    }

    private void requireDesignationNameFree(UUID tenantId, String name, UUID excludeId) {
        designationRepository.findByNormalisedName(tenantId, name, excludeId).ifPresent(existing -> {
            throw new DuplicateValueException("name",
                    "A designation called \"" + existing.getName() + "\" already exists."
                            + " Names are matched ignoring case and spacing, so \"" + name.trim()
                            + "\" would be the same designation. Choose a different name.");
        });
    }

    /**
     * A designation's parent must be a department in the SAME tenant.
     *
     * <p>RLS already makes another tenant's department unreadable, so this check turns an invisible
     * row into a named refusal rather than a foreign-key violation reported as a generic conflict.
     */
    private void requireParentDepartmentInTenant(UUID tenantId, UUID departmentId) {
        if (departmentId == null) {
            return;
        }
        departmentRepository.findByIdAndTenantId(departmentId, tenantId).orElseThrow(() ->
                new FieldValidationException("DEPARTMENT_NOT_FOUND", "departmentId",
                        "That department no longer exists. Choose one from the list."));
    }

    private void touch(UUID unusedId, java.util.function.Consumer<Instant> setUpdatedAt,
                       java.util.function.Consumer<UUID> setUpdatedBy) {
        setUpdatedAt.accept(Instant.now());
        setUpdatedBy.accept(tenantContext.getUserId().orElse(null));
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    // Raw IllegalStateException deliberately: no tenant in context is a filter-chain invariant
    // breach, not caller input. See the note in EmployeeService.
    private UUID requireTenant() {
        return tenantContext.getTenantId()
                .orElseThrow(() -> new IllegalStateException("No tenant context"));
    }

    private static DepartmentResponse toDepartment(DepartmentEntity d) {
        return new DepartmentResponse(d.getId(), d.getName(), d.getCode(), d.isActive());
    }

    private static DesignationResponse toDesignation(DesignationEntity d) {
        return new DesignationResponse(d.getId(), d.getName(), d.getCode(), d.getDepartmentId(),
                d.isActive());
    }
}
