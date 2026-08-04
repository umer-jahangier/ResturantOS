package io.restaurantos.inventory.web;

import io.restaurantos.inventory.authz.InventoryAuthorizationService;
import io.restaurantos.inventory.dto.MenuItemCatalogDtos.MenuItemCatalogDto;
import io.restaurantos.inventory.service.MenuItemCatalogService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import io.restaurantos.shared.security.JwtClaims;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Read-only listing of the tenant-scoped menu-item catalog read-model (D-02), for the
 * recipe-builder picker (08.1-04). Gated on {@code inventory.item.view} via
 * {@link InventoryAuthorizationService} — the T-8-AC mitigation.
 */
@RestController
@RequestMapping("/api/v1/inventory/menu-items")
@RequiresFeature("FEATURE_INVENTORY")
public class MenuItemCatalogController {

    private final InventoryAuthorizationService authz;
    private final MenuItemCatalogService catalogService;

    public MenuItemCatalogController(InventoryAuthorizationService authz, MenuItemCatalogService catalogService) {
        this.authz = authz;
        this.catalogService = catalogService;
    }

    @GetMapping
    public ResponseEntity<ApiResponse<List<MenuItemCatalogDto>>> list(@AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeView(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(catalogService.listActive()));
    }
}
