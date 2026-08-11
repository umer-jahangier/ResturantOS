package io.restaurantos.hr.dto;

import io.restaurantos.hr.entity.EmployeeEntity.EmploymentType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Employee request/response DTOs. Responses expose only MASKED cnic/bank account (last 4) — the
 * raw decrypted PII is never serialized. {@code deviceUserRef} is non-sensitive and settable at
 * onboarding so an employee is pre-mapped to a biometric device PIN (avoids first-punch quarantine).
 */
public final class EmployeeDtos {

    private EmployeeDtos() {
    }

    public record CreateEmployeeRequest(
            @NotBlank String employeeNo,
            @NotBlank String fullName,
            UUID userId,
            String cnic,
            String bankAccountNo,
            // Ids, not free text (35-05). The names live in `departments`/`designations`, which
            // the tenant maintains; a text box here is what produced three spellings of one
            // department. Nullable: an employee genuinely may have neither.
            UUID designationId,
            UUID departmentId,
            @NotNull EmploymentType employmentType,
            @NotNull LocalDate joinDate,
            // A negative salary is not a smaller number, it is an aborted payroll cycle: it
            // annualizes to a negative taxable income, no tax slab matches (every slab has
            // minPaisa >= 0), and SlabTaxCalculator throws "No matching tax slab" — which kills
            // calculate() for EVERY employee in the run, not just this one. Rejected at the edge.
            @PositiveOrZero long basicSalaryPaisa,
            String deviceUserRef) {
    }

    public record UpdateEmployeeRequest(
            @NotBlank String fullName,
            UUID userId,
            String cnic,
            String bankAccountNo,
            UUID designationId,
            UUID departmentId,
            @NotNull EmploymentType employmentType,
            // Same guard as on create — both are @Valid-bound, and without it here a PUT walks
            // straight past the create-side constraint into the same broken payroll run.
            @PositiveOrZero long basicSalaryPaisa,
            String deviceUserRef) {
    }

    public record EmployeeResponse(
            UUID id,
            UUID branchId,
            String employeeNo,
            String fullName,
            UUID userId,
            String cnicMasked,
            String bankAccountMasked,
            // Both the id and the resolved name, so a table renders a department without a second
            // request per row — and so a client that only wants to display does not have to join.
            UUID designationId,
            String designationName,
            UUID departmentId,
            String departmentName,
            EmploymentType employmentType,
            LocalDate joinDate,
            LocalDate exitDate,
            long basicSalaryPaisa,
            String deviceUserRef,
            boolean active) {
    }
}
