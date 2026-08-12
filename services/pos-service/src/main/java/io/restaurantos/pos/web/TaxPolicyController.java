package io.restaurantos.pos.web;

import io.restaurantos.pos.dto.TaxPolicyDtos.TaxPolicyDto;
import io.restaurantos.pos.dto.TaxPolicyDtos.UpdateTaxPolicyRequest;
import io.restaurantos.pos.service.TaxPolicyService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * A tenant's sales-tax base position (V27).
 *
 * <pre>
 * GET /api/v1/pos/tax-policy   pos.menu.view    read which base checks are taxed on
 * PUT /api/v1/pos/tax-policy   pos.tax.manage   set it
 * </pre>
 *
 * <p>The read and the write carry different codes on purpose — see
 * {@code TaxPolicyServiceImpl.get} and {@code .update}. The gates are declared here AND asserted
 * in the service, the same belt-and-braces every other pos admin surface uses: the annotation is
 * what a reader of the route sees, and the service check is what survives being called from a
 * consumer or a test that bypasses MVC.
 *
 * <p>TENANT-scoped, so no id in the path — unlike {@code ServiceChargeController}, which is
 * branch-scoped because a tenant admin administering two dining rooms switches between them on one
 * screen. There is nothing to switch between here: a sales-tax position is a fact about the
 * business, and a product that let one branch tax the net while another taxed the gross would be
 * offering to file two different returns for one registration.
 *
 * <p><b>There is no screen for this yet.</b> No sales-tax configuration screen exists anywhere in
 * the product — {@code ReceiptDocumentAssembler} is blocked on the same absence for its per-code
 * tax display name. This endpoint is what makes the setting reachable in the meantime, by an OWNER
 * or TENANT_ADMIN who already holds {@code pos.tax.manage}; a screen can be hung off it later
 * without changing the contract.
 */
@RestController
@RequestMapping("/api/v1/pos/tax-policy")
@RequiresFeature("FEATURE_POS")
public class TaxPolicyController {

    private final TaxPolicyService taxPolicyService;

    public TaxPolicyController(TaxPolicyService taxPolicyService) {
        this.taxPolicyService = taxPolicyService;
    }

    @PreAuthorize("hasAuthority('pos.menu.view')")
    @GetMapping
    public ResponseEntity<ApiResponse<TaxPolicyDto>> get() {
        return ResponseEntity.ok(ApiResponse.ok(taxPolicyService.get()));
    }

    @PreAuthorize("hasAuthority('pos.tax.manage')")
    @PutMapping
    public ResponseEntity<ApiResponse<TaxPolicyDto>> update(
            @Valid @RequestBody UpdateTaxPolicyRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(taxPolicyService.update(request)));
    }
}
