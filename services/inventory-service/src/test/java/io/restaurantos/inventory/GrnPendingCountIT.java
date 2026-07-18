package io.restaurantos.inventory;

import io.restaurantos.inventory.domain.model.InventoryMovement;
import io.restaurantos.inventory.repository.InventoryMovementRepository;
import io.restaurantos.inventory.web.InternalGrnController;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Finance seam (07-02-D): {@code GET /internal/grn/pending-count} returns a bare {@code Long}
 * body (NOT ApiResponse-wrapped), mirroring pos-service's {@code InternalPosController} exact
 * contract required by finance-service's {@code InventoryInternalClient}. Drives {@link
 * InternalGrnController} directly (bean-level) against a live Testcontainers Postgres — mirrors
 * pos-service's {@code OpenOrdersCountInternalIT} precedent for internal-endpoint ITs.
 *
 * <p>Assumption A1 (08-RESEARCH.md): "pending GRN" has no real inventory concept until Phase 10's
 * purchasing/3-way-match exists, so {@code GrnPendingCountRepository.countPendingAsOf}
 * structurally returns 0 against real production data (ReceiptService never writes the
 * {@code PENDING_GRN} sentinel {@code reference_type} this query filters on). This test proves
 * the query is genuinely tenant-scoped by writing sentinel rows directly for two tenants.
 */
class GrnPendingCountIT extends InventoryTestBase {

    @Autowired InternalGrnController internalGrnController;
    @Autowired InventoryMovementRepository movementRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);
    }

    private InventoryMovement pendingGrnSentinelMovement(UUID forTenantId) {
        InventoryMovement movement = new InventoryMovement();
        movement.setTenantId(forTenantId);
        movement.setBranchId(branchId);
        movement.setIngredientId(UUID.randomUUID());
        movement.setMovementType("RECEIPT");
        movement.setQty(BigDecimal.TEN);
        movement.setUnitCostPaisa(100L);
        movement.setTotalCostPaisa(1000L);
        movement.setReferenceType("PENDING_GRN");
        movement.setMovementAt(Instant.now());
        return movement;
    }

    @Test
    void pendingGrnCount_returnsBareLongBody() {
        ResponseEntity<Long> response = internalGrnController.pendingGrnCount(LocalDate.now(), null);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody()).isEqualTo(0L);
    }

    @Test
    void pendingGrnCount_isTenantScoped_noCrossTenantLeakage() {
        movementRepository.save(pendingGrnSentinelMovement(tenantId));

        UUID otherTenantId = UUID.randomUUID();
        tenantContext.clear();
        tenantContext.set(otherTenantId, branchId, null, null);
        movementRepository.save(pendingGrnSentinelMovement(otherTenantId));

        tenantContext.clear();
        tenantContext.set(tenantId, branchId, null, null);
        ResponseEntity<Long> responseForTenant = internalGrnController.pendingGrnCount(LocalDate.now(), null);
        assertThat(responseForTenant.getBody()).isEqualTo(1L);

        tenantContext.clear();
        tenantContext.set(otherTenantId, branchId, null, null);
        ResponseEntity<Long> responseForOtherTenant =
                internalGrnController.pendingGrnCount(LocalDate.now(), null);
        assertThat(responseForOtherTenant.getBody()).isEqualTo(1L);
    }
}
