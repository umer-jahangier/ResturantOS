package io.restaurantos.finance.web;

import io.restaurantos.finance.config.InternalTenantContextHelper;
import io.restaurantos.finance.domain.enums.PeriodStatus;
import io.restaurantos.finance.dto.AccountingPeriodDto;
import io.restaurantos.finance.dto.ProvisionRequest;
import io.restaurantos.finance.dto.ProvisioningResult;
import io.restaurantos.finance.exception.InvalidFiscalYearException;
import io.restaurantos.finance.service.AccountingPeriodService;
import io.restaurantos.finance.service.PeriodCloseService;
import io.restaurantos.finance.service.ProvisioningService;
import io.restaurantos.finance.util.PakistanFiscalYear;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
public class PeriodController {

    private static final int MIN_PLAUSIBLE_FISCAL_YEAR = 2000;
    private static final int MAX_FUTURE_YEARS_AHEAD = 5;

    private final AccountingPeriodService periodService;
    private final PeriodCloseService periodCloseService;
    private final InternalTenantContextHelper tenantHelper;
    private final ProvisioningService provisioningService;
    private final TenantContext tenantContext;

    public PeriodController(AccountingPeriodService periodService,
                             PeriodCloseService periodCloseService,
                             InternalTenantContextHelper tenantHelper,
                             ProvisioningService provisioningService,
                             TenantContext tenantContext) {
        this.periodService = periodService;
        this.periodCloseService = periodCloseService;
        this.tenantHelper = tenantHelper;
        this.provisioningService = provisioningService;
        this.tenantContext = tenantContext;
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

    /**
     * Self-service (re-)provisioning of CoA + accounting periods for the caller's own tenant (FIN-08).
     * tenantId is resolved ONLY from the JWT-derived TenantContext — never client-supplied — so
     * cross-tenant provisioning is impossible by construction. Delegates to the already-idempotent
     * {@link ProvisioningService#provision(UUID, int)}; safe to call repeatedly.
     */
    @PostMapping("/api/v1/finance/periods/provision")
    @PreAuthorize("hasAuthority('finance.period.open')")
    public ResponseEntity<ApiResponse<ProvisioningResult>> provisionPeriods(
            @RequestBody(required = false) ProvisionRequest request) {
        int fiscalYear = (request != null && request.fiscalYear() != null)
                ? request.fiscalYear()
                : PakistanFiscalYear.current();
        int maxPlausibleFiscalYear = PakistanFiscalYear.current() + MAX_FUTURE_YEARS_AHEAD;
        if (fiscalYear < MIN_PLAUSIBLE_FISCAL_YEAR || fiscalYear > maxPlausibleFiscalYear) {
            throw new InvalidFiscalYearException(fiscalYear);
        }
        return ResponseEntity.ok(ApiResponse.ok(
                provisioningService.provision(tenantContext.requireTenantId(), fiscalYear)));
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
