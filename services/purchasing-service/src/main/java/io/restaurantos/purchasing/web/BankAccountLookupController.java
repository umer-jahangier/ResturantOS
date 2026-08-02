package io.restaurantos.purchasing.web;

import io.restaurantos.purchasing.feign.FinanceInternalClient;
import io.restaurantos.purchasing.feign.FinanceInternalClient.GlAccountDto;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * The accounts a vendor payment can be paid FROM.
 *
 * <p>Until this existed, the AP payment dialog asked whoever was paying to type a GL account code,
 * pre-filled with a hard-coded {@code "1110"}. That is the one screen in purchasing that moves real
 * money, and the code it credits was a free-text box: a typo posts the credit to whatever account
 * happens to match, or fails after the fact. The chart of accounts was already readable — but only
 * with {@code finance.coa.view}, which MANAGER does not hold even though MANAGER holds
 * {@code vendor.payment.create}. The person allowed to pay could not see what they were paying
 * from, so they typed it.
 *
 * <p>A scoped proxy fixes that without widening anyone's finance access, exactly as
 * inventory-service's {@code GlAccountController} does for its category pickers: gated on
 * {@code vendor.payment.create}, scoped to the JWT's tenant, and narrowed to active asset accounts
 * that read as cash or bank. There is no way to reach the rest of the chart and no write path.
 */
@RestController
@RequestMapping("/api/v1/purchasing/bank-accounts")
@RequiresFeature("FEATURE_VENDOR")
public class BankAccountLookupController {

    /** A payment credits one of these; nothing else in the chart can be paid from. */
    private static final List<String> ASSET_TYPES = List.of("ASSET");
    private static final int MAX_RESULTS = 50;

    private final FinanceInternalClient financeInternalClient;
    private final TenantContext tenantContext;

    public BankAccountLookupController(FinanceInternalClient financeInternalClient,
                                       TenantContext tenantContext) {
        this.financeInternalClient = financeInternalClient;
        this.tenantContext = tenantContext;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('vendor.payment.create')")
    public ResponseEntity<ApiResponse<List<GlAccountDto>>> list() {
        UUID tenantId = tenantContext.requireTenantId();
        ApiResponse<List<GlAccountDto>> response =
                financeInternalClient.searchAccounts(tenantId, "", ASSET_TYPES, MAX_RESULTS);
        List<GlAccountDto> accounts = response == null || response.data() == null
                ? List.of() : response.data();

        // Parent codes are headings ("1100 Bank Accounts"); posting to a heading is what makes a
        // trial balance unreadable, so only leaves are offered.
        Set<String> parents = accounts.stream()
                .map(GlAccountDto::parentCode)
                .filter(java.util.Objects::nonNull)
                .collect(java.util.stream.Collectors.toSet());

        return ResponseEntity.ok(ApiResponse.ok(accounts.stream()
                .filter(GlAccountDto::active)
                .filter(a -> !parents.contains(a.code()))
                .filter(a -> a.name() != null
                        && a.name().toLowerCase(java.util.Locale.ROOT).matches("^(bank|cash|petty).*"))
                .toList()));
    }
}
