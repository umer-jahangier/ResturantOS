package io.restaurantos.inventory.web;

import io.restaurantos.inventory.authz.InventoryAuthorizationService;
import io.restaurantos.inventory.dto.StorageLocationDtos.CreateStorageLocationRequest;
import io.restaurantos.inventory.dto.StorageLocationDtos.StorageLocationDto;
import io.restaurantos.inventory.dto.StorageLocationDtos.UpdateStorageLocationRequest;
import io.restaurantos.inventory.service.StorageLocationService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import io.restaurantos.shared.security.JwtClaims;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Tenant-managed storage locations (V10). Same OPA shape as every other inventory master-data
 * controller — reads require {@code inventory.item.view}, writes {@code inventory.item.manage},
 * and no new permission code is introduced. Archive/restore are POST sub-resources rather than
 * {@code DELETE}, so the API surface itself says nothing is destroyed (D-04).
 */
@RestController
@RequestMapping("/api/v1/inventory/storage-locations")
@RequiresFeature("FEATURE_INVENTORY")
public class StorageLocationController {

    private final InventoryAuthorizationService authz;
    private final StorageLocationService storageLocationService;

    public StorageLocationController(InventoryAuthorizationService authz,
                                      StorageLocationService storageLocationService) {
        this.authz = authz;
        this.storageLocationService = storageLocationService;
    }

    @GetMapping
    public ResponseEntity<ApiResponse<List<StorageLocationDto>>> list(
            @RequestParam(defaultValue = "false") boolean includeArchived,
            @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeView(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(storageLocationService.list(includeArchived)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<StorageLocationDto>> create(
            @Valid @RequestBody CreateStorageLocationRequest request,
            @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeManage(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(storageLocationService.create(request)));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<StorageLocationDto>> update(
            @PathVariable UUID id, @Valid @RequestBody UpdateStorageLocationRequest request,
            @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeManage(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(storageLocationService.update(id, request)));
    }

    @PostMapping("/{id}/archive")
    public ResponseEntity<ApiResponse<StorageLocationDto>> archive(
            @PathVariable UUID id, @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeManage(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(storageLocationService.archive(id)));
    }

    @PostMapping("/{id}/restore")
    public ResponseEntity<ApiResponse<StorageLocationDto>> restore(
            @PathVariable UUID id, @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeManage(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(storageLocationService.restore(id)));
    }
}
