package io.restaurantos.hr.service;

import io.restaurantos.hr.dto.EmployeeDtos.CreateEmployeeRequest;
import io.restaurantos.hr.dto.EmployeeDtos.EmployeeResponse;
import io.restaurantos.hr.dto.EmployeeDtos.UpdateEmployeeRequest;
import io.restaurantos.hr.authz.HrAuthorizationService;
import io.restaurantos.hr.entity.EmployeeEntity;
import io.restaurantos.hr.repository.EmployeeRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Employee CRUD. Tenant + branch are ALWAYS taken from {@link TenantContext}, never from the
 * request. Create/deactivate publish EMPLOYEE_JOINED / EMPLOYEE_LEFT through the transactional
 * outbox on {@code hr.topic}.
 *
 * <h2>Branch isolation is enforced by policy, not by the query</h2>
 *
 * <p>{@link #load(UUID)} resolves by tenant only. That used to be the whole story, and it meant
 * {@code get}, {@code update} and {@code deactivate} reached ANY employee in the tenant: a manager
 * at one branch could read and modify {@code basicSalaryPaisa} at another. {@code hr.rego} had
 * required {@code same_tenant_and_branch} on all nine HR actions since it was written, with 28
 * passing tests — and hr-service had no OPA client at all, so none of it applied.
 *
 * <p>The fix is not a narrower {@code WHERE} clause. Each of those three methods now loads the
 * record and hands the record's OWN tenant and branch to {@link HrAuthorizationService}, so OPA
 * decides. A cross-branch request is refused by {@code hr.rego} as a 403, not hidden by a query as
 * a 404, and the policy stays the thing that can be tested, audited and changed. See
 * {@code HrAuthorizationService} for why that ordering matters.
 */
@Service
public class EmployeeService {

    private static final String HR_EXCHANGE = "hr.topic";

    private final EmployeeRepository repository;
    private final TenantContext tenantContext;
    private final EventPublisher eventPublisher;
    private final HrAuthorizationService authorization;

    public EmployeeService(EmployeeRepository repository, TenantContext tenantContext,
                           EventPublisher eventPublisher, HrAuthorizationService authorization) {
        this.repository = repository;
        this.tenantContext = tenantContext;
        this.eventPublisher = eventPublisher;
        this.authorization = authorization;
    }

    @Transactional
    public EmployeeResponse create(CreateEmployeeRequest req) {
        UUID tenantId = requireTenant();
        UUID branchId = requireBranch();
        // The new record is created in the caller's own branch, so that is the resource scope.
        authorization.authorizeEmployeeManage(tenantId, branchId);
        if (repository.existsByTenantIdAndEmployeeNo(tenantId, req.employeeNo())) {
            throw new IllegalStateException("Employee number already exists: " + req.employeeNo());
        }
        EmployeeEntity e = new EmployeeEntity();
        e.setTenantId(tenantId);
        e.setBranchId(branchId);
        e.setUserId(req.userId());
        e.setEmployeeNo(req.employeeNo());
        e.setFullName(req.fullName());
        e.setCnic(req.cnic());
        e.setBankAccountNo(req.bankAccountNo());
        e.setDesignation(req.designation());
        e.setDepartment(req.department());
        e.setEmploymentType(req.employmentType());
        e.setJoinDate(req.joinDate());
        e.setBasicSalaryPaisa(req.basicSalaryPaisa());
        e.setDeviceUserRef(req.deviceUserRef());
        e.setActive(true);
        e = repository.save(e);
        publishEmployeeEvent("hr.employee.joined", "EMPLOYEE_JOINED", e);
        return toResponse(e);
    }

    @Transactional(readOnly = true)
    public List<EmployeeResponse> list() {
        UUID branchId = requireBranch();
        authorization.authorizeEmployeeView(requireTenant(), branchId);
        return repository.findAllByBranchId(branchId).stream().map(EmployeeService::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public EmployeeResponse get(UUID id) {
        EmployeeEntity e = load(id);
        authorization.authorizeEmployeeView(e.getId(), e.getTenantId(), e.getBranchId());
        return toResponse(e);
    }

    @Transactional
    public EmployeeResponse update(UUID id, UpdateEmployeeRequest req) {
        EmployeeEntity e = load(id);
        authorization.authorizeEmployeeManage(e.getId(), e.getTenantId(), e.getBranchId());
        e.setFullName(req.fullName());
        e.setUserId(req.userId());
        // Encrypted PII is write-only from the client's point of view: reads return only masked
        // values (cnicMasked / bankAccountMasked), so a UI round-trip cannot echo the real value
        // back. Assigning unconditionally therefore DESTROYED the stored CNIC and bank account on
        // any partial update — or wrote the mask itself back over the ciphertext. Null/blank now
        // means "leave unchanged"; send a new value to actually change one.
        // Same rule purchasing already applies to vendor bank accounts.
        if (hasText(req.cnic())) {
            e.setCnic(req.cnic());
        }
        if (hasText(req.bankAccountNo())) {
            e.setBankAccountNo(req.bankAccountNo());
        }
        e.setDesignation(req.designation());
        e.setDepartment(req.department());
        e.setEmploymentType(req.employmentType());
        e.setBasicSalaryPaisa(req.basicSalaryPaisa());
        e.setDeviceUserRef(req.deviceUserRef());
        return toResponse(repository.save(e));
    }

    @Transactional
    public void deactivate(UUID id) {
        EmployeeEntity e = load(id);
        authorization.authorizeEmployeeManage(e.getId(), e.getTenantId(), e.getBranchId());
        e.setActive(false);
        e.setExitDate(LocalDate.now());
        e = repository.save(e);
        publishEmployeeEvent("hr.employee.left", "EMPLOYEE_LEFT", e);
    }

    /**
     * Resolves by tenant only, DELIBERATELY. Callers must authorize the loaded record's own branch
     * through {@link HrAuthorizationService} before acting on it — narrowing this query instead
     * would make the policy check unreachable and therefore untestable. See the class javadoc.
     */
    private EmployeeEntity load(UUID id) {
        return repository.findByIdAndTenantId(id, requireTenant())
                .orElseThrow(() -> new IllegalArgumentException("Employee not found: " + id));
    }

    private UUID requireTenant() {
        return tenantContext.getTenantId()
                .orElseThrow(() -> new IllegalStateException("No tenant context"));
    }

    private UUID requireBranch() {
        return tenantContext.getBranchId()
                .orElseThrow(() -> new IllegalStateException("No branch context"));
    }

    private void publishEmployeeEvent(String routingKey, String eventType, EmployeeEntity e) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("employeeId", e.getId());
        payload.put("employeeNo", e.getEmployeeNo());
        payload.put("branchId", e.getBranchId());
        payload.put("joinDate", e.getJoinDate());
        payload.put("exitDate", e.getExitDate());
        eventPublisher.publish(HR_EXCHANGE, routingKey, eventType, e.getBranchId(), payload);
    }

    private static EmployeeResponse toResponse(EmployeeEntity e) {
        return new EmployeeResponse(
                e.getId(), e.getBranchId(), e.getEmployeeNo(), e.getFullName(), e.getUserId(),
                maskLast4(e.getCnic()), maskLast4(e.getBankAccountNo()),
                e.getDesignation(), e.getDepartment(), e.getEmploymentType(),
                e.getJoinDate(), e.getExitDate(), e.getBasicSalaryPaisa(),
                e.getDeviceUserRef(), e.isActive());
    }

    /** True when the caller actually supplied a value (used to leave encrypted PII unchanged). */
    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    /** Never returns raw PII: masks all but the last 4 characters. */
    private static String maskLast4(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String trimmed = value.trim();
        if (trimmed.length() <= 4) {
            return "****";
        }
        return "****" + trimmed.substring(trimmed.length() - 4);
    }
}
