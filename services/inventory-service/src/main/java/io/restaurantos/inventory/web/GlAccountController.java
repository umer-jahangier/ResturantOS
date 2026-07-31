package io.restaurantos.inventory.web;

import io.restaurantos.inventory.authz.InventoryAuthorizationService;
import io.restaurantos.inventory.dto.ItemCategoryDtos.GlAccountOptionDto;
import io.restaurantos.inventory.service.GlAccountLookupService;
import io.restaurantos.inventory.service.GlAccountUsage;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import io.restaurantos.shared.security.JwtClaims;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Chart-of-accounts lookup for the category form's GL account pickers.
 *
 * <p>A scoped proxy onto finance-service, NOT a general accounts API. It exists so an inventory
 * manager can choose GL accounts without being granted {@code finance.coa.view} — that permission
 * carries the whole finance read surface (and sits beside its {@code manage} siblings), which is a
 * lot of authority to hand out so somebody can fill in three fields on a category. Today it is
 * held only by OWNER / TENANT_ADMIN / ACCOUNTANT / FINANCE_VIEWER, so without this endpoint the
 * pickers would be empty for exactly the people who use them.
 *
 * <p>What the caller gets instead is deliberately narrow: gated on {@code inventory.item.view},
 * scoped to the tenant on the JWT, and filtered to ACTIVE accounts whose type the requested slot
 * accepts. There is no way to reach the rest of the chart, and no write path at all.
 */
@RestController
@RequestMapping("/api/v1/inventory/gl-accounts")
@RequiresFeature("FEATURE_INVENTORY")
public class GlAccountController {

    private final InventoryAuthorizationService authz;
    private final GlAccountLookupService glAccountLookupService;

    public GlAccountController(InventoryAuthorizationService authz,
                                GlAccountLookupService glAccountLookupService) {
        this.authz = authz;
        this.glAccountLookupService = glAccountLookupService;
    }

    /**
     * @param usage which category slot the account is for — INVENTORY, COST or WASTE. Required:
     *              it is what narrows the result to acceptable account types, and defaulting it
     *              would quietly widen the very surface this endpoint keeps narrow.
     * @param q     free-text match on code or name; blank is valid and returns the first page, so
     *              the dropdown has something to show before the user types
     */
    @GetMapping
    public ResponseEntity<ApiResponse<List<GlAccountOptionDto>>> search(
            @RequestParam String usage,
            @RequestParam(required = false) String q,
            @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeView(claims.tenantId(), claims.branchId());
        GlAccountUsage resolvedUsage = GlAccountUsage.from(usage);
        List<GlAccountOptionDto> options = glAccountLookupService.search(resolvedUsage, q).stream()
                .map(a -> new GlAccountOptionDto(a.id(), a.code(), a.name(), a.accountType()))
                .toList();
        return ResponseEntity.ok(ApiResponse.ok(options));
    }
}
