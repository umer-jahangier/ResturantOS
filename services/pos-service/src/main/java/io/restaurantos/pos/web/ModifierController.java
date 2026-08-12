package io.restaurantos.pos.web;

import io.restaurantos.pos.dto.ModifierDtos.CreateModifierGroupRequest;
import io.restaurantos.pos.dto.ModifierDtos.CreateModifierRequest;
import io.restaurantos.pos.dto.ModifierDtos.ModifierGroupDto;
import io.restaurantos.pos.dto.ModifierDtos.ModifierOptionDto;
import io.restaurantos.pos.dto.ModifierDtos.UpdateModifierGroupRequest;
import io.restaurantos.pos.dto.ModifierDtos.UpdateModifierRequest;
import io.restaurantos.pos.service.ModifierCatalogueService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * The modifier catalogue's routes (S6) — the ones that never existed.
 *
 * <pre>
 * GET    /menu/modifier-groups                          pos.menu.view    the till's one read
 * GET    /menu/items/{itemId}/modifier-groups           pos.menu.view    one dish, active only
 * GET    /menu/items/{itemId}/modifier-groups/admin     pos.menu.manage  one dish, incl. retired
 * POST   /menu/items/{itemId}/modifier-groups           pos.menu.manage
 * PUT    /menu/modifier-groups/{groupId}                pos.menu.manage
 * DELETE /menu/modifier-groups/{groupId}                pos.menu.manage
 * POST   /menu/modifier-groups/{groupId}/modifiers      pos.menu.manage
 * PUT    /menu/modifiers/{modifierId}                   pos.menu.manage
 * DELETE /menu/modifiers/{modifierId}                   pos.menu.manage
 * </pre>
 *
 * <p>Lives under {@code /api/v1/pos/menu} rather than in {@link MenuController} because that class
 * is already 180 lines of categories and items and this is a third noun with its own lifecycle —
 * but under the same prefix, because the gateway routes on it and a modifier is menu configuration
 * in every sense that matters to a permission.
 */
@RestController
@RequestMapping("/api/v1/pos/menu")
@RequiresFeature("FEATURE_POS")
public class ModifierController {

    private final ModifierCatalogueService service;

    public ModifierController(ModifierCatalogueService service) {
        this.service = service;
    }

    /**
     * The whole tenant's live catalogue, in one call.
     *
     * <p>The till loads this ONCE beside the menu and holds it. A per-tap fetch would put a network
     * round trip between the cashier's finger and the dialog, and would make an offline terminal
     * unable to configure a dish at all — the two failure modes a till cannot have.
     */
    @PreAuthorize("hasAuthority('pos.menu.view')")
    @GetMapping("/modifier-groups")
    public ResponseEntity<ApiResponse<List<ModifierGroupDto>>> listAll() {
        return ResponseEntity.ok(ApiResponse.ok(service.listAllActive()));
    }

    @PreAuthorize("hasAuthority('pos.menu.view')")
    @GetMapping("/items/{itemId}/modifier-groups")
    public ResponseEntity<ApiResponse<List<ModifierGroupDto>>> listForItem(@PathVariable UUID itemId) {
        return ResponseEntity.ok(ApiResponse.ok(service.listForItem(itemId)));
    }

    /** Manage-screen read — includes retired groups and retired options, greyed rather than gone. */
    @PreAuthorize("hasAuthority('pos.menu.manage')")
    @GetMapping("/items/{itemId}/modifier-groups/admin")
    public ResponseEntity<ApiResponse<List<ModifierGroupDto>>> listForItemAdmin(@PathVariable UUID itemId) {
        return ResponseEntity.ok(ApiResponse.ok(service.listForItemAdmin(itemId)));
    }

    @PreAuthorize("hasAuthority('pos.menu.manage')")
    @PostMapping("/items/{itemId}/modifier-groups")
    public ResponseEntity<ApiResponse<ModifierGroupDto>> createGroup(
            @PathVariable UUID itemId,
            @Valid @RequestBody CreateModifierGroupRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(service.createGroup(itemId, request)));
    }

    @PreAuthorize("hasAuthority('pos.menu.manage')")
    @PutMapping("/modifier-groups/{groupId}")
    public ResponseEntity<ApiResponse<ModifierGroupDto>> updateGroup(
            @PathVariable UUID groupId,
            @Valid @RequestBody UpdateModifierGroupRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(service.updateGroup(groupId, request)));
    }

    @PreAuthorize("hasAuthority('pos.menu.manage')")
    @DeleteMapping("/modifier-groups/{groupId}")
    public ResponseEntity<ApiResponse<Void>> deleteGroup(@PathVariable UUID groupId) {
        service.deleteGroup(groupId);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @PreAuthorize("hasAuthority('pos.menu.manage')")
    @PostMapping("/modifier-groups/{groupId}/modifiers")
    public ResponseEntity<ApiResponse<ModifierOptionDto>> createOption(
            @PathVariable UUID groupId,
            @Valid @RequestBody CreateModifierRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(service.createOption(groupId, request)));
    }

    @PreAuthorize("hasAuthority('pos.menu.manage')")
    @PutMapping("/modifiers/{modifierId}")
    public ResponseEntity<ApiResponse<ModifierOptionDto>> updateOption(
            @PathVariable UUID modifierId,
            @Valid @RequestBody UpdateModifierRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(service.updateOption(modifierId, request)));
    }

    @PreAuthorize("hasAuthority('pos.menu.manage')")
    @DeleteMapping("/modifiers/{modifierId}")
    public ResponseEntity<ApiResponse<Void>> deleteOption(@PathVariable UUID modifierId) {
        service.deleteOption(modifierId);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }
}
