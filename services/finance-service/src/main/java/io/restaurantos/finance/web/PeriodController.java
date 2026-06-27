package io.restaurantos.finance.web;

import io.restaurantos.finance.domain.enums.PeriodStatus;
import io.restaurantos.finance.dto.AccountingPeriodDto;
import io.restaurantos.finance.service.AccountingPeriodService;
import io.restaurantos.finance.service.PeriodCloseService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
public class PeriodController {

    private final AccountingPeriodService periodService;
    private final PeriodCloseService periodCloseService;

    public PeriodController(AccountingPeriodService periodService,
                             PeriodCloseService periodCloseService) {
        this.periodService = periodService;
        this.periodCloseService = periodCloseService;
    }

    @GetMapping("/api/v1/finance/periods")
    public ResponseEntity<List<AccountingPeriodDto>> listPeriods(
            @RequestParam(required = false) Integer fiscalYear,
            @RequestParam(required = false) PeriodStatus status) {
        List<AccountingPeriodDto> periods;
        if (fiscalYear != null) {
            periods = periodService.listByFiscalYear(fiscalYear);
        } else if (status != null) {
            periods = periodService.listByStatus(status);
        } else {
            periods = periodService.listByFiscalYear(java.time.Year.now().getValue());
        }
        return ResponseEntity.ok(periods);
    }

    @GetMapping("/api/v1/finance/periods/{id}")
    public ResponseEntity<AccountingPeriodDto> getPeriod(@PathVariable UUID id) {
        return ResponseEntity.ok(periodService.getById(id));
    }

    @PostMapping("/api/v1/finance/periods/{id}/close")
    public ResponseEntity<AccountingPeriodDto> closePeriod(
            @PathVariable UUID id,
            @RequestHeader(value = "X-TOTP-Verified", defaultValue = "false") boolean totpVerified) {
        return ResponseEntity.ok(periodCloseService.close(id, totpVerified));
    }

    /**
     * Internal endpoint for auto-posting consumers (e.g. POS, Inventory).
     * Returns the currently OPEN period for the given tenant.
     * No OPA authorization — protected by X-Internal-Secret header (gateway config).
     */
    @GetMapping("/internal/periods/current")
    public ResponseEntity<AccountingPeriodDto> getCurrentPeriod(
            @RequestParam UUID tenantId) {
        return periodService.getCurrentOpenPeriod()
                .map(p -> ResponseEntity.ok(new AccountingPeriodDto(
                        p.getId(), p.getFiscalYear(), p.getPeriodNo(),
                        p.getStartDate(), p.getEndDate(), p.getStatus(),
                        p.getLockedBy(), p.getLockedAt())))
                .orElse(ResponseEntity.notFound().build());
    }
}
