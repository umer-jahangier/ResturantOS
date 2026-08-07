package io.restaurantos.hr;

import io.restaurantos.hr.dto.EmployeeDtos.CreateEmployeeRequest;
import io.restaurantos.hr.dto.EmployeeDtos.EmployeeResponse;
import io.restaurantos.hr.dto.EmployeeDtos.UpdateEmployeeRequest;
import io.restaurantos.hr.entity.EmployeeEntity.EmploymentType;
import io.restaurantos.hr.repository.EmployeeRepository;
import io.restaurantos.hr.service.EmployeeService;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.LocalDate;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * A manager at one branch cannot read or modify an employee at another branch of the same tenant.
 *
 * <h2>What this proves, and why it did not exist before</h2>
 *
 * <p>{@code hr.rego} has demanded {@code same_tenant_and_branch} on all nine HR actions since it was
 * written, with 28 tests in {@code policies/tests/hr_test.rego} covering exactly this case. Every one
 * of them passed while the defect was live, because {@code hr-service} contained no OPA client at
 * all: the policy was correct, tested, and never consulted. {@code EmployeeService.load(id)}
 * resolved by {@code findByIdAndTenantId} — tenant-scoped, branch-blind — so {@code GET},
 * {@code PUT} and the deactivate path reached any employee in the tenant, including their
 * {@code basicSalaryPaisa}.
 *
 * <p>Run against the commit before the fix, {@link #managerAtBranchA_cannotReadEmployeeAtBranchB()}
 * and {@link #managerAtBranchA_cannotModifySalaryAtBranchB()} both FAIL — the read returns Branch B's
 * employee and the write persists a new salary. That is the regression these two lock down.
 *
 * <p>The OPA container here runs the repository's real {@code policies/} bundle (see
 * {@link HrTestBase}), so the refusal below is produced by {@code hr.rego} itself rather than by a
 * stub, a {@code WHERE} clause or an assertion in Java. If someone deletes the policy call from
 * {@code EmployeeService}, these fail; if someone weakens the rego, these fail too.
 *
 * <p>{@link #managerAtOwnBranch_stillHasFullAccess()} is the other half, and matters just as much:
 * branch isolation that also blocks legitimate same-branch access is not a fix.
 */
class EmployeeBranchIsolationIT extends HrTestBase {

    @Autowired EmployeeService employeeService;
    @Autowired EmployeeRepository employeeRepository;
    @Autowired TenantContext tenantContext;

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID BRANCH_A = UUID.randomUUID();
    private static final UUID BRANCH_B = UUID.randomUUID();

    /** Creates an employee at {@code branch}, acting as a manager of that branch. */
    private EmployeeResponse createAt(UUID branch, String employeeNo, long salaryPaisa) {
        tenantContext.set(TENANT, branch, UUID.randomUUID(), null);
        try {
            return employeeService.create(new CreateEmployeeRequest(
                    employeeNo, "Employee " + employeeNo, null, "4210112345678",
                    "PK36SCBL0000001123456702", "Chef", "Kitchen",
                    EmploymentType.PERMANENT, LocalDate.of(2025, 1, 1), salaryPaisa, null));
        } finally {
            tenantContext.clear();
        }
    }

    @Test
    void managerAtBranchA_cannotReadEmployeeAtBranchB() {
        EmployeeResponse atB = createAt(BRANCH_B, "EMP-ISO-READ", 50_000_00L);

        tenantContext.set(TENANT, BRANCH_A, UUID.randomUUID(), null);
        try {
            assertThatThrownBy(() -> employeeService.get(atB.id()))
                    .as("hr.rego's same_tenant_and_branch must refuse a cross-branch employee read. "
                            + "Before phase 18b this returned the record, salary included.")
                    .isInstanceOf(PermissionDeniedException.class);
        } finally {
            tenantContext.clear();
        }
    }

    @Test
    void managerAtBranchA_cannotModifySalaryAtBranchB() {
        EmployeeResponse atB = createAt(BRANCH_B, "EMP-ISO-WRITE", 50_000_00L);

        tenantContext.set(TENANT, BRANCH_A, UUID.randomUUID(), null);
        try {
            assertThatThrownBy(() -> employeeService.update(atB.id(), new UpdateEmployeeRequest(
                    "Renamed By Other Branch", null, null, null, "Chef", "Kitchen",
                    EmploymentType.PERMANENT, 99_999_00L, null)))
                    .isInstanceOf(PermissionDeniedException.class);
        } finally {
            tenantContext.clear();
        }

        // The refusal must be a refusal, not a rollback of a write that already happened.
        tenantContext.set(TENANT, BRANCH_B, UUID.randomUUID(), null);
        try {
            assertThat(employeeRepository.findByIdAndTenantId(atB.id(), TENANT).orElseThrow())
                    .satisfies(e -> {
                        assertThat(e.getBasicSalaryPaisa()).isEqualTo(50_000_00L);
                        assertThat(e.getFullName()).isEqualTo("Employee EMP-ISO-WRITE");
                    });
        } finally {
            tenantContext.clear();
        }
    }

    @Test
    void managerAtBranchA_cannotDeactivateEmployeeAtBranchB() {
        EmployeeResponse atB = createAt(BRANCH_B, "EMP-ISO-DEACT", 50_000_00L);

        tenantContext.set(TENANT, BRANCH_A, UUID.randomUUID(), null);
        try {
            assertThatThrownBy(() -> employeeService.deactivate(atB.id()))
                    .isInstanceOf(PermissionDeniedException.class);
        } finally {
            tenantContext.clear();
        }

        tenantContext.set(TENANT, BRANCH_B, UUID.randomUUID(), null);
        try {
            assertThat(employeeRepository.findByIdAndTenantId(atB.id(), TENANT).orElseThrow().isActive())
                    .as("a refused deactivate must leave the employee active")
                    .isTrue();
        } finally {
            tenantContext.clear();
        }
    }

    /**
     * The control case. A fix that denies everything is not a fix — the same manager, acting at the
     * branch that owns the record, must still read and write it exactly as before.
     */
    @Test
    void managerAtOwnBranch_stillHasFullAccess() {
        EmployeeResponse atA = createAt(BRANCH_A, "EMP-ISO-OWN", 40_000_00L);

        tenantContext.set(TENANT, BRANCH_A, UUID.randomUUID(), null);
        try {
            assertThat(employeeService.get(atA.id()).id()).isEqualTo(atA.id());
            assertThatCode(() -> employeeService.update(atA.id(), new UpdateEmployeeRequest(
                    "Renamed By Own Branch", null, null, null, "Chef", "Kitchen",
                    EmploymentType.PERMANENT, 45_000_00L, null)))
                    .doesNotThrowAnyException();
            assertThat(employeeService.get(atA.id()).basicSalaryPaisa()).isEqualTo(45_000_00L);
            assertThat(employeeService.list()).extracting(EmployeeResponse::id).contains(atA.id());
        } finally {
            tenantContext.clear();
        }
    }
}
