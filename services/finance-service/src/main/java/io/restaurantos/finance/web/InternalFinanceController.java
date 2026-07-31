package io.restaurantos.finance.web;

import io.restaurantos.finance.config.InternalTenantContextHelper;
import io.restaurantos.finance.domain.enums.AccountType;
import io.restaurantos.finance.dto.AccountDto;
import io.restaurantos.finance.dto.ArTransactionDto;
import io.restaurantos.finance.dto.InternalArChargeRequest;
import io.restaurantos.finance.dto.InternalAutoPostJeRequest;
import io.restaurantos.finance.dto.InternalJePostResponse;
import io.restaurantos.finance.dto.PeriodStatusResponse;
import io.restaurantos.finance.service.AccountingPeriodService;
import io.restaurantos.finance.service.ArService;
import io.restaurantos.finance.service.CoaService;
import io.restaurantos.finance.service.JournalEntryService;
import io.restaurantos.shared.api.ApiResponse;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Guarded by {@code FinanceInternalServiceFilter} (X-Internal-Service secret) — NOT
 * {@code @PreAuthorize}, since /internal/** has no user principal. On the RBAC-gate reflection
 * guard's ({@link io.restaurantos.finance.FinanceEndpointAuthorizationIT}) internal allowlist.
 */
@RestController
@RequestMapping("/internal/finance")
public class InternalFinanceController {

    private final JournalEntryService jeService;
    private final AccountingPeriodService periodService;
    private final ArService arService;
    private final CoaService coaService;
    private final InternalTenantContextHelper tenantHelper;

    public InternalFinanceController(JournalEntryService jeService,
                                       AccountingPeriodService periodService,
                                       ArService arService,
                                       CoaService coaService,
                                       InternalTenantContextHelper tenantHelper) {
        this.jeService = jeService;
        this.periodService = periodService;
        this.arService = arService;
        this.coaService = coaService;
        this.tenantHelper = tenantHelper;
    }

    @PostMapping("/journal-entries")
    public ResponseEntity<ApiResponse<InternalJePostResponse>> autoPost(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @Valid @RequestBody InternalAutoPostJeRequest req) {
        // Branch-scoped: autoPostInternal -> create() -> requireBranchId() reads the branch off
        // TenantContext, and the branchId-less activate(tenantId) leaves it empty -> "Branch context
        // required". The branch is already on the request body, so pass it through. Without this,
        // every GRN receipt failed to post its GR/IR journal entry (purchasing saw a 400 from this
        // endpoint), and the same gap produced the long-standing InternalAutoPostIT /
        // JournalEntryImmutabilityIT / JournalEntryBalanceTriggerIT failures that were repeatedly
        // written off as pre-existing test noise.
        tenantHelper.activate(tenantId, req.branchId());
        try {
            InternalJePostResponse result = jeService.autoPostInternal(req);
            return ResponseEntity.ok(ApiResponse.ok(result));
        } finally {
            tenantHelper.clear();
        }
    }

    /**
     * THE PHASE 7 SEAM: Phase 7's plan 07-05 will call this on POS order close for the
     * "charge to account" tender. Idempotent on (tenantId, POS_ORDER, orderId) — POS may
     * retry freely on timeout. See 10-18-SUMMARY.md for the full contract POS must handle
     * (422 CREDIT_LIMIT_EXCEEDED / CUSTOMER_ACCOUNT_SUSPENDED, 404 CUSTOMER_ACCOUNT_NOT_FOUND,
     * 423 PERIOD_LOCKED — all of which POS must surface as a tender failure and not close the
     * order on that tender).
     */
    @PostMapping("/ar/charges")
    public ResponseEntity<ApiResponse<ArTransactionDto>> arCharge(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @Valid @RequestBody InternalArChargeRequest req) {
        tenantHelper.activate(tenantId, req.branchId());
        try {
            return ResponseEntity.ok(ApiResponse.ok(arService.chargeFromOrder(req)));
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

    /**
     * Chart-of-accounts search for other services' account pickers, narrowed to active accounts of
     * the requested types.
     *
     * <p>Exists so a service can offer its users an account picker WITHOUT them holding
     * {@code finance.coa.view}. Inventory's category form is the first caller: an inventory manager
     * needs to name three GL accounts, but granting them the finance permission would hand over the
     * whole chart-of-accounts surface (and its {@code manage} siblings) to fill in three fields.
     * Instead the caller gates on its own permission and brokers the lookup through here, which
     * returns nothing but active accounts of the types it asked for.
     *
     * @param types required — an unfiltered chart is never what a picker wants, and defaulting to
     *              "all" would quietly re-open the surface this endpoint exists to keep narrow
     */
    @GetMapping("/accounts/search")
    public ResponseEntity<ApiResponse<List<AccountDto>>> searchAccounts(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @RequestParam(required = false) String q,
            @RequestParam List<AccountType> types,
            @PageableDefault(size = 20) Pageable pageable) {
        tenantHelper.activate(tenantId);
        try {
            Page<AccountDto> page = coaService.searchActiveAccountsForTenant(tenantId, q, types, pageable);
            return ResponseEntity.ok(ApiResponse.ok(page.getContent()));
        } finally {
            tenantHelper.clear();
        }
    }

    /**
     * Batch resolve account codes, for a caller validating account references at write time.
     *
     * <p>Returns a code → account map containing ONLY the codes that resolved; the caller decides
     * what an absent code means for the specific field it came from, which is what lets inventory
     * answer "Inventory GL account 14OO doesn't exist" instead of one generic rejection.
     */
    @PostMapping("/accounts/resolve")
    public ResponseEntity<ApiResponse<Map<String, AccountDto>>> resolveAccounts(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @RequestBody List<String> codes) {
        tenantHelper.activate(tenantId);
        try {
            return ResponseEntity.ok(ApiResponse.ok(coaService.resolveByCodes(tenantId, codes)));
        } finally {
            tenantHelper.clear();
        }
    }

    /** Id-keyed counterpart of {@link #resolveAccounts} for callers storing an account's id. */
    @PostMapping("/accounts/resolve-by-id")
    public ResponseEntity<ApiResponse<Map<UUID, AccountDto>>> resolveAccountsById(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @RequestBody List<UUID> ids) {
        tenantHelper.activate(tenantId);
        try {
            return ResponseEntity.ok(ApiResponse.ok(coaService.resolveByIds(tenantId, ids)));
        } finally {
            tenantHelper.clear();
        }
    }
}
