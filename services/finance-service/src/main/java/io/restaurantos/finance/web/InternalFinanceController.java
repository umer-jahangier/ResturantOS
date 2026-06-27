package io.restaurantos.finance.web;

import io.restaurantos.finance.config.InternalTenantContextHelper;
import io.restaurantos.finance.dto.InternalAutoPostJeRequest;
import io.restaurantos.finance.dto.InternalJePostResponse;
import io.restaurantos.finance.dto.PeriodStatusResponse;
import io.restaurantos.finance.service.AccountingPeriodService;
import io.restaurantos.finance.service.JournalEntryService;
import io.restaurantos.shared.api.ApiResponse;
import jakarta.validation.Valid;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.UUID;

@RestController
@RequestMapping("/internal/finance")
public class InternalFinanceController {

    private final JournalEntryService jeService;
    private final AccountingPeriodService periodService;
    private final InternalTenantContextHelper tenantHelper;

    public InternalFinanceController(JournalEntryService jeService,
                                       AccountingPeriodService periodService,
                                       InternalTenantContextHelper tenantHelper) {
        this.jeService = jeService;
        this.periodService = periodService;
        this.tenantHelper = tenantHelper;
    }

    @PostMapping("/journal-entries")
    public ResponseEntity<ApiResponse<InternalJePostResponse>> autoPost(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @Valid @RequestBody InternalAutoPostJeRequest req) {
        tenantHelper.activate(tenantId);
        try {
            InternalJePostResponse result = jeService.autoPostInternal(req);
            return ResponseEntity.ok(ApiResponse.ok(result));
        } finally {
            tenantHelper.clear();
        }
    }

    @GetMapping("/periods/status")
    public ResponseEntity<ApiResponse<PeriodStatusResponse>> periodStatus(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @RequestParam UUID branchId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        tenantHelper.activate(tenantId);
        try {
            return ResponseEntity.ok(ApiResponse.ok(periodService.getPeriodStatus(branchId, date)));
        } finally {
            tenantHelper.clear();
        }
    }
}
