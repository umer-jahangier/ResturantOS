package io.restaurantos.finance.web;

import io.restaurantos.finance.domain.enums.AccountType;
import io.restaurantos.finance.dto.AccountDto;
import io.restaurantos.finance.dto.CreateAccountRequest;
import io.restaurantos.finance.dto.FinanceSetupStatusDto;
import io.restaurantos.finance.service.CoaService;
import io.restaurantos.finance.authz.FinanceAuthorizationService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.api.PageMeta;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
import java.util.List;

@RestController
@RequestMapping("/api/v1/finance/accounts")
public class AccountController {

    private final CoaService coaService;
    private final FinanceAuthorizationService authorization;
    private final TenantContext tenantContext;

    public AccountController(CoaService coaService,
                             FinanceAuthorizationService authorization,
                             TenantContext tenantContext) {
        this.coaService = coaService;
        this.authorization = authorization;
        this.tenantContext = tenantContext;
    }


    /**
     * finance.rego's {@code view_coa} / {@code manage_coa} rules, wired in phase 18b — both were
     * dead letters, so the chart of accounts was gated by {@code @PreAuthorize} alone. Both rules
     * are tenant-scoped ({@code same_tenant}, not {@code same_tenant_and_branch}), so the
     * caller's own tenant is the complete resource scope and there is no per-account branch to
     * resolve.
     */
    private void authorizeView() {
        authorization.authorizeViewCoa(tenantContext.requireTenantId(),
                tenantContext.getBranchId().orElse(null));
    }

    private void authorizeManage() {
        authorization.authorizeManageCoa(tenantContext.requireTenantId(),
                tenantContext.getBranchId().orElse(null));
    }

    @GetMapping
    @PreAuthorize("hasAuthority('finance.coa.view')")
    public ResponseEntity<ApiResponse<List<AccountDto>>> listAccounts(
            @RequestParam(required = false) AccountType type,
            @RequestParam(required = false) Boolean active,
            @PageableDefault(size = 50) Pageable pageable) {
        authorizeView();
        Page<AccountDto> page = coaService.listAccounts(type, active, pageable);
        return ResponseEntity.ok(ApiResponse.paginated(page.getContent(), new PageMeta(
                new PageMeta.Page(
                        String.valueOf(page.getNumber()),
                        page.hasNext() ? String.valueOf(page.getNumber() + 1) : null,
                        page.getSize()),
                page.getTotalElements())));
    }

    @GetMapping("/search")
    @PreAuthorize("hasAuthority('finance.coa.view')")
    public ResponseEntity<ApiResponse<List<AccountDto>>> searchAccounts(
            @RequestParam String q,
            @PageableDefault(size = 20) Pageable pageable) {
        authorizeView();
        Page<AccountDto> page = coaService.searchActiveAccounts(q, pageable);
        return ResponseEntity.ok(ApiResponse.paginated(page.getContent(), new PageMeta(
                new PageMeta.Page(
                        String.valueOf(page.getNumber()),
                        page.hasNext() ? String.valueOf(page.getNumber() + 1) : null,
                        page.getSize()),
                page.getTotalElements())));
    }

    @GetMapping("/setup/status")
    @PreAuthorize("hasAuthority('finance.coa.view')")
    public ResponseEntity<ApiResponse<FinanceSetupStatusDto>> setupStatus() {
        authorizeView();
        return ResponseEntity.ok(ApiResponse.ok(coaService.getSetupStatus()));
    }

    @GetMapping("/{code}")
    @PreAuthorize("hasAuthority('finance.coa.view')")
    public ResponseEntity<ApiResponse<AccountDto>> getAccount(@PathVariable String code) {
        authorizeView();
        return ResponseEntity.ok(ApiResponse.ok(coaService.getAccountByCode(code)));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('finance.coa.manage')")
    public ResponseEntity<ApiResponse<AccountDto>> createAccount(
            @Valid @RequestBody CreateAccountRequest req) {
        authorizeManage();
        AccountDto created = coaService.createCustomAccount(req);
        return ResponseEntity.created(URI.create("/api/v1/finance/accounts/" + created.code()))
                .body(ApiResponse.ok(created));
    }
}
