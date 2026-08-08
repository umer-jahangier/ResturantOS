package io.restaurantos.hr.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.hr.dto.PayrollDtos.CreateRunRequest;
import io.restaurantos.hr.dto.PayrollDtos.PayslipResponse;
import io.restaurantos.hr.dto.PayrollDtos.RunResponse;
import io.restaurantos.hr.entity.PayrollRunEntity;
import io.restaurantos.hr.entity.PayslipEntity;
import io.restaurantos.hr.service.PayrollRunService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.idempotency.IdempotencyService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * Payroll run REST API. create + calculate require an {@code Idempotency-Key} and
 * {@code hr.payroll.run}; approve/pay require {@code hr.payroll.approve} (approve is TOTP step-up
 * gated via {@code X-TOTP-Verified}, same trust model as finance period-close).
 */
@RestController
@RequestMapping("/api/v1/hr/payroll-runs")
public class PayrollRunController {

    private static final int IDEMPOTENCY_TTL_SECONDS = 3600;

    private final PayrollRunService payrollRunService;
    private final IdempotencyService idempotencyService;
    private final ObjectMapper objectMapper;

    public PayrollRunController(PayrollRunService payrollRunService,
                               IdempotencyService idempotencyService,
                               ObjectMapper objectMapper) {
        this.payrollRunService = payrollRunService;
        this.idempotencyService = idempotencyService;
        this.objectMapper = objectMapper;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('hr.payroll.run')")
    public ApiResponse<RunResponse> create(@RequestHeader("Idempotency-Key") String key,
                                           @Valid @RequestBody CreateRunRequest req) {
        return idempotent(key, "create:" + req.periodMonth() + ":" + req.periodYear(),
                () -> toRunResponse(payrollRunService.create(req.periodMonth(), req.periodYear())));
    }

    @PostMapping("/{id}/calculate")
    @PreAuthorize("hasAuthority('hr.payroll.run')")
    public ApiResponse<RunResponse> calculate(@RequestHeader("Idempotency-Key") String key,
                                              @PathVariable UUID id) {
        return idempotent(key, "calculate:" + id,
                () -> toRunResponse(payrollRunService.calculate(id)));
    }

    @PostMapping("/{id}/approve")
    @PreAuthorize("hasAuthority('hr.payroll.approve')")
    public ApiResponse<RunResponse> approve(@PathVariable UUID id,
                                            @RequestHeader(value = "X-TOTP-Verified", defaultValue = "false") boolean totpVerified) {
        return ApiResponse.ok(toRunResponse(payrollRunService.approve(id, totpVerified)));
    }

    @PostMapping("/{id}/pay")
    @PreAuthorize("hasAuthority('hr.payroll.approve')")
    public ApiResponse<RunResponse> pay(@PathVariable UUID id) {
        return ApiResponse.ok(toRunResponse(payrollRunService.pay(id)));
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('hr.payroll.view')")
    public ApiResponse<RunResponse> get(@PathVariable UUID id) {
        return ApiResponse.ok(toRunResponse(payrollRunService.get(id)));
    }

    @GetMapping
    @PreAuthorize("hasAuthority('hr.payroll.view')")
    public ApiResponse<List<RunResponse>> list() {
        return ApiResponse.ok(payrollRunService.list().stream().map(PayrollRunController::toRunResponse).toList());
    }

    @GetMapping("/{id}/payslips")
    @PreAuthorize("hasAuthority('hr.payroll.view')")
    public ApiResponse<List<PayslipResponse>> payslips(@PathVariable UUID id) {
        return ApiResponse.ok(payrollRunService.payslips(id).stream().map(PayrollRunController::toPayslipResponse).toList());
    }

    private ApiResponse<RunResponse> idempotent(String key, String requestHash, Supplier<RunResponse> work) {
        var cached = idempotencyService.getCompletedResponse(key);
        if (cached.isPresent()) {
            return ApiResponse.ok(readValue(cached.get()));
        }
        if (!idempotencyService.checkAndLock(key, requestHash, IDEMPOTENCY_TTL_SECONDS)) {
            throw new IllegalStateException("Duplicate or in-progress request for Idempotency-Key " + key);
        }
        RunResponse result = work.get();
        idempotencyService.markComplete(key, writeValue(result));
        return ApiResponse.ok(result);
    }

    private RunResponse readValue(String json) {
        try {
            return objectMapper.readValue(json, RunResponse.class);
        } catch (Exception e) {
            throw new IllegalStateException("Corrupt idempotent response", e);
        }
    }

    private String writeValue(RunResponse response) {
        try {
            return objectMapper.writeValueAsString(response);
        } catch (Exception e) {
            throw new IllegalStateException("Cannot serialize idempotent response", e);
        }
    }

    private static RunResponse toRunResponse(PayrollRunEntity r) {
        return new RunResponse(r.getId(), r.getPeriodMonth(), r.getPeriodYear(), r.getStatus(),
                r.getTotalGrossPaisa(), r.getTotalNetPaisa(), r.getBranchId(), r.getRunBy(),
                r.getApprovedBy(), r.getPaidAt());
    }

    private static PayslipResponse toPayslipResponse(PayslipEntity p) {
        return new PayslipResponse(p.getId(), p.getRunId(), p.getEmployeeId(), p.getBasicPaisa(),
                p.getAllowancesJson(), p.getGrossPaisa(), p.getDeductionsJson(), p.getNetPaisa());
    }
}
