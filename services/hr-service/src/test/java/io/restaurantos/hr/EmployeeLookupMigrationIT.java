package io.restaurantos.hr;

import io.restaurantos.hr.dto.EmployeeDtos.CreateEmployeeRequest;
import io.restaurantos.hr.dto.EmployeeDtos.EmployeeResponse;
import io.restaurantos.hr.dto.HrConfigDtos.CreateDepartmentRequest;
import io.restaurantos.hr.dto.HrConfigDtos.DepartmentResponse;
import io.restaurantos.hr.entity.EmployeeEntity.EmploymentType;
import io.restaurantos.hr.service.EmployeeService;
import io.restaurantos.hr.service.HrConfigService;
import io.restaurantos.shared.exception.FieldValidationException;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

/**
 * Employees reference department and designation ROWS, and nobody's data was thrown away.
 *
 * <h2>What the 015 migration had to get right</h2>
 *
 * The obvious way to move off two free-text columns is to drop them and let everyone re-enter their
 * departments. That is not a migration, it is data loss with a changelog id. Every pre-existing
 * employee keeps the department they had — and the DEDUPLICATION is the repair: three spellings of
 * "Waiter" collapse to one row and all three employees end up pointing at it.
 *
 * <p>The backfill's behaviour on genuinely messy data is verified separately and directly against
 * the shipped SQL (see 35-05-SUMMARY). What this class asserts is the state the migration leaves
 * the SCHEMA in, and that the service refuses the three ways a bad id can arrive.
 */
class EmployeeLookupMigrationIT extends HrTestBase {

    @Autowired EmployeeService employeeService;
    @Autowired HrConfigService hrConfigService;
    @Autowired TenantContext tenantContext;

    @Test
    @DisplayName("the free-text columns are gone and the id columns exist")
    void freeTextColumnsNoLongerExist() throws SQLException {
        try (Connection c = superuser(); Statement s = c.createStatement();
             ResultSet rs = s.executeQuery("""
                     SELECT column_name FROM information_schema.columns
                     WHERE table_name = 'employees'
                       AND column_name IN ('department','designation','department_id','designation_id')
                     ORDER BY column_name
                     """)) {
            java.util.List<String> columns = new java.util.ArrayList<>();
            while (rs.next()) {
                columns.add(rs.getString(1));
            }
            // Leaving the TEXT columns alongside the ids is how two representations drift, and a
            // later reader cannot tell which is authoritative.
            assertThat(columns).containsExactly("department_id", "designation_id");
        }
    }

    @Test
    @DisplayName("an employee created with a department id carries back the id AND the resolved name")
    void responseCarriesIdAndResolvedName() {
        UUID tenant = UUID.randomUUID();
        tenantContext.set(tenant, UUID.randomUUID(), UUID.randomUUID(), null);
        try {
            DepartmentResponse kitchen =
                    hrConfigService.createDepartment(new CreateDepartmentRequest("Kitchen", null));

            EmployeeResponse created = employeeService.create(new CreateEmployeeRequest(
                    "EMP-LOOKUP", "Named Person", null, null, null,
                    null, kitchen.id(), EmploymentType.PERMANENT,
                    LocalDate.of(2026, 1, 1), 5_000_000L, null));

            assertThat(created.departmentId()).isEqualTo(kitchen.id());
            // The name too, so a table renders a department without a second request per row.
            assertThat(created.departmentName()).isEqualTo("Kitchen");
            assertThat(created.designationId()).isNull();
            assertThat(created.designationName()).isNull();
        } finally {
            tenantContext.clear();
        }
    }

    @Test
    @DisplayName("an employee may have no department, and is not assigned an invented default")
    void noDepartmentIsAllowedAndNotDefaulted() {
        UUID tenant = UUID.randomUUID();
        tenantContext.set(tenant, UUID.randomUUID(), UUID.randomUUID(), null);
        try {
            EmployeeResponse created = employeeService.create(new CreateEmployeeRequest(
                    "EMP-NONE", "Unassigned", null, null, null, null, null,
                    EmploymentType.CONTRACT, LocalDate.of(2026, 1, 1), 0L, null));

            assertThat(created.departmentId()).isNull();
            assertThat(created.departmentName()).isNull();
        } finally {
            tenantContext.clear();
        }
    }

    @Test
    @DisplayName("an unknown department id is refused on the departmentId field, not as a 500")
    void unknownDepartmentIsRefusedWithAFieldPath() {
        UUID tenant = UUID.randomUUID();
        tenantContext.set(tenant, UUID.randomUUID(), UUID.randomUUID(), null);
        try {
            FieldValidationException thrown = catchThrowableOfType(FieldValidationException.class,
                    () -> employeeService.create(new CreateEmployeeRequest(
                            "EMP-BADDEPT", "Bad Dept", null, null, null,
                            null, UUID.randomUUID(), EmploymentType.PERMANENT,
                            LocalDate.of(2026, 1, 1), 0L, null)));

            assertThat(thrown).isNotNull();
            assertThat(thrown.getCode()).isEqualTo("DEPARTMENT_NOT_FOUND");
            assertThat(thrown.getViolations()).singleElement()
                    .satisfies(v -> assertThat(v.field()).isEqualTo("departmentId"));
        } finally {
            tenantContext.clear();
        }
    }

    @Test
    @DisplayName("another tenant's department id is refused with a field path, not a FK violation")
    void crossTenantDepartmentIsRefusedWithAFieldPath() {
        UUID owner = UUID.randomUUID();
        UUID intruder = UUID.randomUUID();

        UUID theirDepartment;
        tenantContext.set(owner, UUID.randomUUID(), UUID.randomUUID(), null);
        try {
            theirDepartment = hrConfigService
                    .createDepartment(new CreateDepartmentRequest("Kitchen", null)).id();
        } finally {
            tenantContext.clear();
        }

        tenantContext.set(intruder, UUID.randomUUID(), UUID.randomUUID(), null);
        try {
            FieldValidationException thrown = catchThrowableOfType(FieldValidationException.class,
                    () -> employeeService.create(new CreateEmployeeRequest(
                            "EMP-XTENANT", "Cross Tenant", null, null, null,
                            null, theirDepartment, EmploymentType.PERMANENT,
                            LocalDate.of(2026, 1, 1), 0L, null)));

            assertThat(thrown).isNotNull();
            assertThat(thrown.getViolations()).singleElement()
                    .satisfies(v -> assertThat(v.field()).isEqualTo("departmentId"));
        } finally {
            tenantContext.clear();
        }
    }

    /**
     * An owner deactivated that department on purpose. Quietly assigning new people to it would
     * make the deactivation meaningless, and the message says how to undo it either way.
     */
    @Test
    @DisplayName("a deactivated department is refused, with an instruction naming both ways out")
    void deactivatedDepartmentIsRefused() {
        UUID tenant = UUID.randomUUID();
        tenantContext.set(tenant, UUID.randomUUID(), UUID.randomUUID(), null);
        try {
            DepartmentResponse retired =
                    hrConfigService.createDepartment(new CreateDepartmentRequest("Retired Dept", null));
            hrConfigService.setDepartmentActive(retired.id(), false);

            FieldValidationException thrown = catchThrowableOfType(FieldValidationException.class,
                    () -> employeeService.create(new CreateEmployeeRequest(
                            "EMP-INACTIVE", "Inactive Dept", null, null, null,
                            null, retired.id(), EmploymentType.PERMANENT,
                            LocalDate.of(2026, 1, 1), 0L, null)));

            assertThat(thrown).isNotNull();
            assertThat(thrown.getCode()).isEqualTo("DEPARTMENT_INACTIVE");
            assertThat(thrown.getViolations()).singleElement().satisfies(v -> {
                assertThat(v.field()).isEqualTo("departmentId");
                assertThat(v.instruction()).contains("Retired Dept").contains("reactivate");
            });

            // But an employee already on it keeps rendering — that is why deactivate, not delete.
            hrConfigService.setDepartmentActive(retired.id(), true);
            EmployeeResponse ok = employeeService.create(new CreateEmployeeRequest(
                    "EMP-REACTIVATED", "Fine Now", null, null, null,
                    null, retired.id(), EmploymentType.PERMANENT,
                    LocalDate.of(2026, 1, 1), 0L, null));
            hrConfigService.setDepartmentActive(retired.id(), false);
            assertThat(employeeService.get(ok.id()).departmentName()).isEqualTo("Retired Dept");
        } finally {
            tenantContext.clear();
        }
    }

    private Connection superuser() throws SQLException {
        return DriverManager.getConnection(
                postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
    }

    @SuppressWarnings("unused")
    private static final List<String> DOCUMENTED_CODES =
            List.of("DEPARTMENT_NOT_FOUND", "DEPARTMENT_INACTIVE",
                    "DESIGNATION_NOT_FOUND", "DESIGNATION_INACTIVE");
}
