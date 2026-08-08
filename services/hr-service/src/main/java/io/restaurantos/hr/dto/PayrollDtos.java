package io.restaurantos.hr.dto;

import io.restaurantos.hr.entity.PayrollRunEntity.Status;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public final class PayrollDtos {

    private PayrollDtos() {
    }

    public record CreateRunRequest(
            @Min(1) @Max(12) int periodMonth,
            @Min(2000) int periodYear) {
    }

    public record RunResponse(
            UUID id,
            int periodMonth,
            int periodYear,
            Status status,
            long totalGrossPaisa,
            long totalNetPaisa,
            UUID branchId,
            UUID runBy,
            UUID approvedBy,
            Instant paidAt) {
    }

    public record PayslipResponse(
            UUID id,
            UUID runId,
            UUID employeeId,
            long basicPaisa,
            Map<String, Long> allowances,
            long grossPaisa,
            Map<String, Long> deductions,
            long netPaisa) {
    }
}
