package io.restaurantos.finance.web;

import io.restaurantos.finance.dto.ArAgingReportDto;
import io.restaurantos.finance.dto.ArTransactionDto;
import io.restaurantos.finance.dto.CreateArChargeRequest;
import io.restaurantos.finance.dto.CreateArSettlementRequest;
import io.restaurantos.finance.dto.CreateCustomerAccountRequest;
import io.restaurantos.finance.dto.CustomerAccountDto;
import io.restaurantos.finance.dto.CustomerAccountStatementDto;
import io.restaurantos.finance.service.ArService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.api.PageMeta;
import io.restaurantos.shared.feature.RequiresFeature;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * FIN-05 AR half (10-18): house/corporate customer accounts, AR charges/settlements, AR aging.
 * AR ships under the existing FEATURE_FINANCE flag — no FEATURE_AR was introduced (10-11's nav
 * drift test would fail the build on a phantom flag). AR is NOT OPA-gated (10-18-B) — every
 * method here carries only the RBAC @PreAuthorize gate.
 */
@RestController
@RequestMapping("/api/v1/finance/ar")
@RequiresFeature("FEATURE_FINANCE")
public class ArController {

    private final ArService arService;

    public ArController(ArService arService) {
        this.arService = arService;
    }

    @PostMapping("/customer-accounts")
    @PreAuthorize("hasAuthority('finance.ar.manage')")
    public ApiResponse<CustomerAccountDto> createAccount(@Valid @RequestBody CreateCustomerAccountRequest req) {
        return ApiResponse.ok(arService.createAccount(req));
    }

    @GetMapping("/customer-accounts")
    @PreAuthorize("hasAuthority('finance.ar.view')")
    public ResponseEntity<ApiResponse<List<CustomerAccountDto>>> listAccounts(
            @PageableDefault(size = 50) Pageable pageable) {
        Page<CustomerAccountDto> page = arService.listAccounts(pageable);
        return ResponseEntity.ok(ApiResponse.paginated(page.getContent(), new PageMeta(
                new PageMeta.Page(
                        String.valueOf(page.getNumber()),
                        page.hasNext() ? String.valueOf(page.getNumber() + 1) : null,
                        page.getSize()),
                page.getTotalElements())));
    }

    @GetMapping("/customer-accounts/{id}/statement")
    @PreAuthorize("hasAuthority('finance.ar.view')")
    public ApiResponse<CustomerAccountStatementDto> getStatement(@PathVariable UUID id) {
        return ApiResponse.ok(arService.getStatement(id));
    }

    @PostMapping("/charges")
    @PreAuthorize("hasAuthority('finance.ar.manage')")
    public ApiResponse<ArTransactionDto> charge(@Valid @RequestBody CreateArChargeRequest req) {
        return ApiResponse.ok(arService.charge(req));
    }

    @PostMapping("/settlements")
    @PreAuthorize("hasAuthority('finance.ar.manage')")
    public ApiResponse<ArTransactionDto> settle(@Valid @RequestBody CreateArSettlementRequest req) {
        return ApiResponse.ok(arService.settle(req));
    }

    @GetMapping("/aging")
    @PreAuthorize("hasAuthority('finance.ar.view')")
    public ApiResponse<ArAgingReportDto> aging(
            @RequestParam UUID branchId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate asOf) {
        LocalDate date = asOf != null ? asOf : LocalDate.now();
        return ApiResponse.ok(arService.getAging(branchId, date));
    }
}
