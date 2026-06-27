package io.restaurantos.finance.web;

import io.restaurantos.finance.config.InternalTenantContextHelper;
import io.restaurantos.finance.domain.enums.PeriodStatus;
import io.restaurantos.finance.dto.AccountingPeriodDto;
import io.restaurantos.finance.service.AccountingPeriodService;
import io.restaurantos.finance.service.PeriodCloseService;
import io.restaurantos.finance.util.PakistanFiscalYear;
import io.restaurantos.shared.api.ApiResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
public class PeriodController {

    private final AccountingPeriodService periodService;
    private final PeriodCloseService periodCloseService;
    private final InternalTenantContextHelper tenantHelper;

    public PeriodController(AccountingPeriodService periodService,
                             PeriodCloseService periodCloseService,
                             InternalTenantContextHelper tenantHelper) {
        this.periodService = periodService;
        this.periodCloseService = periodCloseService;
        this.tenantHelper = tenantHelper;
    }

    @GetMapping("/api/v1/finance/periods")
    @PreAuthorize("hasAuthority('finance.journal.view')")
    public ResponseEntity<ApiResponse<List<AccountingPeriodDto>>> listPeriods(
            @RequestParam(required = false) Integer fiscalYear,
            @RequestParam(required = false) PeriodStatus status) {
        List<AccountingPeriodDto> periods;
        if (fiscalYear != null) {
            periods = periodService.listByFiscalYear(fiscalYear);
        } else if (status != null) {
            periods = periodService.listByStatus(status);
        } else {
            periods = periodService.listByFiscalYear(PakistanFiscalYear.current());
        }
        return ResponseEntity.ok(ApiResponse.ok(periods));
    }

    @GetMapping("/api/v1/finance/periods/open")
    @PreAuthorize("hasAuthority('finance.journal.view')")
    public ResponseEntity<ApiResponse<List<AccountingPeriodDto>>> listOpenPeriods() {
        return ResponseEntity.ok(ApiResponse.ok(periodService.listOpenPeriods()));
    }

    @GetMapping("/api/v1/finance/periods/{id}")
    @PreAuthorize("hasAuthority('finance.journal.view')")
    public ResponseEntity<ApiResponse<AccountingPeriodDto>> getPeriod(@PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.ok(periodService.getById(id)));
    }

    @PostMapping("/api/v1/finance/periods/{id}/close")
    @PreAuthorize("hasAuthority('finance.period.close')")
    public ResponseEntity<ApiResponse<AccountingPeriodDto>> closePeriod(
            @PathVariable UUID id,
            @RequestHeader(value = "X-TOTP-Verified", defaultValue = "false") boolean totpVerified) {
        return ResponseEntity.ok(ApiResponse.ok(periodCloseService.close(id, totpVerified)));
    }

    @GetMapping("/internal/periods/current")
    public ResponseEntity<ApiResponse<AccountingPeriodDto>> getCurrentPeriod(
            @RequestParam UUID tenantId) {
        tenantHelper.activate(tenantId);
        try {
            return periodService.getCurrentOpenPeriod()
                    .map(p -> ResponseEntity.ok(ApiResponse.ok(new AccountingPeriodDto(
                            p.getId(), p.getFiscalYear(), p.getPeriodNo(),
                            p.getStartDate(), p.getEndDate(), p.getStatus(),
                            p.getLockedBy(), p.getLockedAt()))))
                    .orElse(ResponseEntity.notFound().build());
        } finally {
            tenantHelper.clear();
        }
    }
}
