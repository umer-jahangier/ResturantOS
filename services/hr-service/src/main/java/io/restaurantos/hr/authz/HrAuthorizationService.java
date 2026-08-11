package io.restaurantos.hr.authz;

import io.restaurantos.shared.authz.AuthorizationService;
import io.restaurantos.shared.authz.OpaInput;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * HR's OPA enforcement point — one method per {@code hr.rego} action.
 *
 * <p>Until this class existed, {@code hr.rego} was a <b>dead letter</b>: nine rules, 28 passing
 * tests, and not one reference to {@code OpaClient} or {@code AuthorizationService} anywhere in
 * {@code hr-service/src/main}. The policy demanded {@code same_tenant_and_branch} on every action
 * and nothing ever asked it.
 *
 * <p>The cost was real. {@code EmployeeService.load(id)} resolved employees with
 * {@code findByIdAndTenantId} — tenant-scoped, branch-blind — so {@code GET}, {@code PUT} and the
 * deactivate path reached <em>any</em> employee in the tenant. A manager at one branch could read
 * and modify {@code basicSalaryPaisa} at another. {@code hr.rego} would have refused all nine
 * actions; it was simply never consulted.
 *
 * <h2>The resource's branch, never the caller's</h2>
 *
 * <p>Every method here takes the tenant and branch <b>of the record being acted on</b>, not of the
 * caller. That distinction is the entire control. Passing {@code tenantContext.getBranchId()} would
 * compare the caller's branch against itself, satisfy {@code same_tenant_and_branch} unconditionally,
 * and produce a call site that looks enforced and denies nothing — a dead letter with extra steps.
 * For list-style actions with no single subject record, the caller's own branch <em>is</em> the
 * resource scope, because the query is branch-scoped in the repository.
 *
 * <h2>Why the repository query stays tenant-scoped</h2>
 *
 * <p>The obvious alternative fix was to change {@code load()} to {@code findByIdAndTenantIdAndBranchId}.
 * That refuses the same requests, but it refuses them as a 404 from a {@code WHERE} clause, and it
 * makes this OPA call unreachable in the only case that matters: the policy would never again see a
 * cross-branch resource, so it could be deleted tomorrow without a single test failing. Loading the
 * record and then asking the policy about its real branch keeps OPA the authority — the refusal is
 * a 403 from {@code hr.rego}, and {@code EmployeeBranchIsolationIT} proves the policy is what
 * produced it.
 *
 * <p>Fail-closed throughout: {@link AuthorizationService} throws {@code PermissionDeniedException}
 * when OPA denies, and {@code DefaultOpaClient} converts any transport error, timeout or
 * unparseable body into the same denial.
 */
@Service
public class HrAuthorizationService {

    private static final String MODULE = "hr";

    private static final String RESOURCE_EMPLOYEE = "employee";
    private static final String RESOURCE_ATTENDANCE = "attendance";
    private static final String RESOURCE_LEAVE = "leave_request";
    private static final String RESOURCE_PAYROLL = "payroll_run";
    private static final String RESOURCE_CONFIG = "hr_config";

    private final AuthorizationService authorizationService;

    public HrAuthorizationService(AuthorizationService authorizationService) {
        this.authorizationService = authorizationService;
    }

    // ── employee ─────────────────────────────────────────────────────────────

    public void authorizeEmployeeView(UUID tenantId, UUID branchId) {
        authorizationService.authorize(MODULE, "employee_view",
                resource(RESOURCE_EMPLOYEE, null, tenantId, branchId));
    }

    /** @param employeeId the record being read, when there is one — carried into the policy input. */
    public void authorizeEmployeeView(UUID employeeId, UUID tenantId, UUID branchId) {
        authorizationService.authorize(MODULE, "employee_view",
                resource(RESOURCE_EMPLOYEE, employeeId, tenantId, branchId));
    }

    public void authorizeEmployeeManage(UUID tenantId, UUID branchId) {
        authorizationService.authorize(MODULE, "employee_manage",
                resource(RESOURCE_EMPLOYEE, null, tenantId, branchId));
    }

    public void authorizeEmployeeManage(UUID employeeId, UUID tenantId, UUID branchId) {
        authorizationService.authorize(MODULE, "employee_manage",
                resource(RESOURCE_EMPLOYEE, employeeId, tenantId, branchId));
    }

    // ── attendance ───────────────────────────────────────────────────────────

    public void authorizeAttendanceView(UUID tenantId, UUID branchId) {
        authorizationService.authorize(MODULE, "attendance_view",
                resource(RESOURCE_ATTENDANCE, null, tenantId, branchId));
    }

    public void authorizeAttendanceManage(UUID tenantId, UUID branchId) {
        authorizationService.authorize(MODULE, "attendance_manage",
                resource(RESOURCE_ATTENDANCE, null, tenantId, branchId));
    }

    // ── leave ────────────────────────────────────────────────────────────────

    public void authorizeLeaveView(UUID tenantId, UUID branchId) {
        authorizationService.authorize(MODULE, "leave_view",
                resource(RESOURCE_LEAVE, null, tenantId, branchId));
    }

    public void authorizeLeaveApprove(UUID leaveRequestId, UUID tenantId, UUID branchId) {
        authorizationService.authorize(MODULE, "leave_approve",
                resource(RESOURCE_LEAVE, leaveRequestId, tenantId, branchId));
    }

    // ── payroll ──────────────────────────────────────────────────────────────

    public void authorizePayrollView(UUID tenantId, UUID branchId) {
        authorizationService.authorize(MODULE, "payroll_view",
                resource(RESOURCE_PAYROLL, null, tenantId, branchId));
    }

    public void authorizePayrollRun(UUID payrollRunId, UUID tenantId, UUID branchId) {
        authorizationService.authorize(MODULE, "payroll_run",
                resource(RESOURCE_PAYROLL, payrollRunId, tenantId, branchId));
    }

    public void authorizePayrollApprove(UUID payrollRunId, UUID tenantId, UUID branchId) {
        authorizationService.authorize(MODULE, "payroll_approve",
                resource(RESOURCE_PAYROLL, payrollRunId, tenantId, branchId));
    }

    // ── configuration (35-03) ────────────────────────────────────────────────

    /**
     * HR configuration is authorised TENANT-wide, and takes no branch.
     *
     * <p>Every other method on this class passes the resource's branch, and that is the entire
     * control for an operational record. Configuration is different in kind: a department list, a
     * leave type, a salary component and the income-tax table belong to the business, not to one of
     * its locations. {@code hr.rego}'s config rules therefore use {@code same_tenant} alone.
     *
     * <p>No branch parameter exists here rather than being accepted and ignored, so a caller cannot
     * pass one and believe it is being enforced. The resource's {@code branch_id} goes to the policy
     * as null, and the policy does not read it.
     *
     * <p>This is NOT a relaxation of phase 18b. The nine operational actions still require
     * {@code same_tenant_and_branch}, and {@code hr_test.rego} asserts that explicitly for all nine.
     */
    public void authorizeConfigView(UUID tenantId) {
        authorizationService.authorize(MODULE, "config_view",
                resource(RESOURCE_CONFIG, null, tenantId, null));
    }

    /**
     * Editing HR configuration, including the tax table.
     *
     * <p>Held only by OWNER and TENANT_ADMIN (auth changeset 046). A branch manager editing the tax
     * table is a money defect whose blast radius is every payslip in the tenant for a year.
     */
    public void authorizeConfigManage(UUID tenantId) {
        authorizationService.authorize(MODULE, "config_manage",
                resource(RESOURCE_CONFIG, null, tenantId, null));
    }

    /**
     * Each method above names its action as a LITERAL in the authorize call rather than passing it
     * to a shared dispatcher. That is deliberate and it is enforced: {@code PolicyReachabilityTest}
     * proves every rego rule has a caller by reading the (module, action) pairs out of the source,
     * and a dispatcher taking {@code String action} hides the pair from it — the test reports such a
     * call site as unresolvable and fails rather than assuming it is fine. Only the resource shape,
     * which the test does not read, is factored out here.
     */
    private static OpaInput.Resource resource(String type, UUID id, UUID tenantId, UUID branchId) {
        return new OpaInput.Resource(type, id, tenantId, branchId, null, null, null);
    }
}
