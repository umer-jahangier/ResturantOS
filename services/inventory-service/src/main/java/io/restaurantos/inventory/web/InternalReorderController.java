package io.restaurantos.inventory.web;

import io.restaurantos.inventory.dto.ReorderDtos.ReorderShortfallsResponse;
import io.restaurantos.inventory.service.ReorderSuggestionService;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * Internal reorder-shortfall seam — what purchasing-service calls to build order suggestions.
 *
 * <p>The split is by ownership: inventory knows what is LOW and by how much (on-hand vs par);
 * purchasing knows who sells it, in what pack, at what price. Neither can answer the question
 * alone, and putting vendor knowledge in inventory (or par levels in purchasing) would be the
 * wrong seam.
 *
 * <p>Secured by the {@code X-Internal-Service} shared-secret header
 * ({@code InventoryInternalServiceFilter}), not JWT/OPA — service-to-service, not user-facing.
 * Mirrors {@link InternalIngredientCategoryController}'s optional {@code X-Tenant-Id} fallback (a
 * Feign client does not forward tenant context) and its bare, non-{@code ApiResponse} body.
 */
@RestController
@RequestMapping("/internal/inventory")
public class InternalReorderController {

    private final ReorderSuggestionService reorderSuggestionService;
    private final TenantContext tenantContext;

    public InternalReorderController(ReorderSuggestionService reorderSuggestionService,
                                      TenantContext tenantContext) {
        this.reorderSuggestionService = reorderSuggestionService;
        this.tenantContext = tenantContext;
    }

    @GetMapping("/reorder-shortfalls")
    public ResponseEntity<ReorderShortfallsResponse> shortfalls(
            @RequestParam UUID branchId,
            @RequestHeader(value = "X-Tenant-Id", required = false) UUID tenantId) {
        if (tenantId != null && tenantContext.getTenantId().isEmpty()) {
            tenantContext.set(tenantId, branchId, null, null);
        }
        return ResponseEntity.ok(reorderSuggestionService.shortfalls(branchId));
    }
}
