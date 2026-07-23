package io.restaurantos.inventory.web;

import io.restaurantos.inventory.dto.InventoryDtos.IngredientCategoryLookupDto;
import io.restaurantos.inventory.service.IngredientService;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Internal ingredient-category resolution seam (08.2-09, D-09) — secured by the
 * {@code X-Internal-Service} shared-secret header ({@code InventoryInternalServiceFilter}), NOT
 * JWT/OPA (service-to-service, not user-facing). This is the seam purchasing-service's
 * spend-analytics category resolver (plan 08.2-11) calls, replacing the
 * {@code MockIngredientCategoryResolver} classpath-map mock (D-09: delete the mock, don't bypass
 * it). Mirrors {@link InternalGrnController}'s optional {@code X-Tenant-Id} header + manual
 * {@code tenantContext.set} fallback (Pitfall 5: a Feign client does not forward tenant context)
 * and its bare (NOT {@code ApiResponse}-wrapped) response body convention.
 *
 * <p>Not reachable from the public gateway route — only {@code /internal/**} paths are ever
 * routed there, and {@link io.restaurantos.inventory.config.InventoryInternalServiceFilter}
 * guards every one of them.
 */
@RestController
@RequestMapping("/internal/inventory")
public class InternalIngredientCategoryController {

    /** T-08.2-096: caps the batch so an unbounded id list cannot be used for a DoS-shaped call. */
    private static final int MAX_BATCH_SIZE = 500;

    private final IngredientService ingredientService;
    private final TenantContext tenantContext;

    public InternalIngredientCategoryController(IngredientService ingredientService, TenantContext tenantContext) {
        this.ingredientService = ingredientService;
        this.tenantContext = tenantContext;
    }

    @GetMapping("/ingredient-categories")
    public ResponseEntity<List<IngredientCategoryLookupDto>> resolveIngredientCategories(
            @RequestParam List<UUID> ingredientIds,
            @RequestHeader(value = "X-Tenant-Id", required = false) UUID tenantId) {
        if (ingredientIds.size() > MAX_BATCH_SIZE) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).build();
        }
        if (tenantId != null && tenantContext.getTenantId().isEmpty()) {
            tenantContext.set(tenantId, null, null, null);
        }
        return ResponseEntity.ok(ingredientService.resolveCategoryLookups(ingredientIds));
    }
}
