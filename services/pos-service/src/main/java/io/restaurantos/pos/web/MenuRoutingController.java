package io.restaurantos.pos.web;

import io.restaurantos.pos.dto.MenuRoutingDto;
import io.restaurantos.pos.service.MenuRoutingQueryService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * {@code GET /api/v1/pos/menu/routing?branchId=} — read what this branch's routing currently is.
 *
 * <p>The two writes ({@code PUT /menu/items/{id}/station}, {@code PUT
 * /menu/categories/{id}/station}) have existed since 28-05 and are unchanged. The screen that
 * calls them could not exist without this read: a category's route was writable and unreadable,
 * so an admin could route "all Drinks to the bar" and nothing in the product could then show that
 * they had.
 *
 * <p>Gated on {@code pos.menu.manage} — the same permission both writes demand. Gating the read
 * more loosely would put a screen in a sidebar whose every control 403s.
 */
@RestController
@RequestMapping("/api/v1/pos/menu")
@RequiresFeature("FEATURE_POS")
public class MenuRoutingController {

    private final MenuRoutingQueryService menuRoutingQueryService;

    public MenuRoutingController(MenuRoutingQueryService menuRoutingQueryService) {
        this.menuRoutingQueryService = menuRoutingQueryService;
    }

    @PreAuthorize("hasAuthority('pos.menu.manage')")
    @GetMapping("/routing")
    public ResponseEntity<ApiResponse<MenuRoutingDto>> routing(@RequestParam UUID branchId) {
        return ResponseEntity.ok(ApiResponse.ok(menuRoutingQueryService.routingFor(branchId)));
    }
}
