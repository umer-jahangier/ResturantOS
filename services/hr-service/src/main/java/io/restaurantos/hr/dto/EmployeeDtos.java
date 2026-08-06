package io.restaurantos.hr.dto;

import io.restaurantos.hr.entity.EmployeeEntity.EmploymentType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

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
            String designation,
            String department,
            @NotNull EmploymentType employmentType,
            @NotNull LocalDate joinDate,
            long basicSalaryPaisa,
            String deviceUserRef) {
    }

    public record UpdateEmployeeRequest(
            @NotBlank String fullName,
            UUID userId,
            String cnic,
            String bankAccountNo,
            String designation,
            String department,
            @NotNull EmploymentType employmentType,
            long basicSalaryPaisa,
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
            String designation,
            String department,
            EmploymentType employmentType,
            LocalDate joinDate,
            LocalDate exitDate,
            long basicSalaryPaisa,
            String deviceUserRef,
            boolean active) {
    }
}
