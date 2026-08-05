package io.restaurantos.inventory.web;

import io.restaurantos.inventory.domain.model.UnitOfMeasure;
import io.restaurantos.inventory.repository.UnitOfMeasureRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * The unit codes a tenant actually defines — so another service can check a unit BEFORE it is
 * saved, rather than discovering it is unresolvable when a goods receipt is being converted.
 *
 * <p>purchasing-service's vendor catalog stores a pack UOM per row, and inventory converts a
 * receipt by looking that exact string up in {@code units_of_measure}. A catalog row saved with
 * "kgs" or "Kilogram" therefore resolved to nothing and the receipt was taken at face value —
 * silently wrong quantity and cost. The picker in the catalog form closed the hole for people;
 * this closes it for the API, which is the half a form cannot reach.
 *
 * <p>Same conventions as {@link InternalIngredientCategoryController}: secured by the
 * {@code X-Internal-Service} shared secret rather than JWT/OPA, optional {@code X-Tenant-Id}
 * header because a Feign client does not forward tenant context, and a bare (not
 * {@code ApiResponse}-wrapped) body. Read-only and tiny — a tenant has tens of units, not
 * thousands, so it is returned whole rather than paged or searched.
 */
@RestController
@RequestMapping("/internal/inventory")
public class InternalUomController {

    private final UnitOfMeasureRepository unitOfMeasureRepository;
    private final TenantContext tenantContext;

    public InternalUomController(UnitOfMeasureRepository unitOfMeasureRepository,
                                 TenantContext tenantContext) {
        this.unitOfMeasureRepository = unitOfMeasureRepository;
        this.tenantContext = tenantContext;
    }

    @GetMapping("/uom-codes")
    public ResponseEntity<List<String>> listUomCodes(
            @RequestHeader(value = "X-Tenant-Id", required = false) UUID tenantId) {
        UUID resolved = tenantId != null ? tenantId : tenantContext.getTenantId().orElse(null);
        if (resolved == null) {
            return ResponseEntity.ok(List.of());
        }
        // Explicitly tenant-scoped, never findAll(): this runs on an internal call with no user
        // principal, so the Hibernate tenant filter cannot be relied on to be enabled.
        return ResponseEntity.ok(unitOfMeasureRepository.findByTenantId(resolved).stream()
                .map(UnitOfMeasure::getCode)
                .toList());
    }
}
