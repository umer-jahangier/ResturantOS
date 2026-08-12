package io.restaurantos.pos.web;

import io.restaurantos.pos.dto.TaxClassDtos.CreateTaxClassRequest;
import io.restaurantos.pos.dto.TaxClassDtos.TaxClassDto;
import io.restaurantos.pos.dto.TaxClassDtos.UpdateTaxClassRequest;
import io.restaurantos.pos.service.TaxClassService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * The tenant's sales-tax catalogue (F16).
 *
 * <pre>
 * GET    /api/v1/pos/tax-classes        pos.menu.view    read the rates
 * POST   /api/v1/pos/tax-classes        pos.tax.manage   define one
 * PUT    /api/v1/pos/tax-classes/{id}   pos.tax.manage   re-rate / rename / retire
 * DELETE /api/v1/pos/tax-classes/{id}   pos.tax.manage   remove one nothing uses
 * </pre>
 *
 * <p>The read and the writes carry different codes on purpose — see
 * {@code PosAuthorizationService.requireTaxManage}. The gates are declared here AND asserted in
 * the service, the same belt-and-braces every other pos admin surface uses: the annotation is what
 * a reader of the route sees, and the service check is what survives being called from a consumer
 * or a test that bypasses MVC.
 */
@RestController
@RequestMapping("/api/v1/pos/tax-classes")
@RequiresFeature("FEATURE_POS")
public class TaxClassController {

    private final TaxClassService taxClassService;

    public TaxClassController(TaxClassService taxClassService) {
        this.taxClassService = taxClassService;
    }

    @PreAuthorize("hasAuthority('pos.menu.view')")
    @GetMapping
    public ResponseEntity<ApiResponse<List<TaxClassDto>>> list() {
        return ResponseEntity.ok(ApiResponse.ok(taxClassService.list()));
    }

    @PreAuthorize("hasAuthority('pos.tax.manage')")
    @PostMapping
    public ResponseEntity<ApiResponse<TaxClassDto>> create(
            @Valid @RequestBody CreateTaxClassRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(taxClassService.create(request)));
    }

    @PreAuthorize("hasAuthority('pos.tax.manage')")
    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<TaxClassDto>> update(
            @PathVariable UUID id,
            @Valid @RequestBody UpdateTaxClassRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(taxClassService.update(id, request)));
    }

    @PreAuthorize("hasAuthority('pos.tax.manage')")
    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable UUID id) {
        taxClassService.delete(id);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }
}
