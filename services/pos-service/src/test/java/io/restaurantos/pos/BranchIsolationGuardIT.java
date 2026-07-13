package io.restaurantos.pos;

import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.OpenTillRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.dto.TillSessionDto;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.TillService;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Branch-isolation guard coverage (Phase 1 security fix): endpoints that accept an explicit
 * {@code branchId} request parameter must reject a client-supplied value that differs from the
 * caller's verified JWT branch. RLS is tenant-only, so without these guards a cashier scoped to
 * branch A could create orders / open tills / read orders and till history under sibling branch B
 * within the same tenant. Each test sets the JWT branch context to {@code ownBranch} and passes a
 * different {@code foreignBranch} to prove the guard denies it (and the matching branch succeeds).
 */
class BranchIsolationGuardIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired TillService tillService;
    @Autowired TenantContext tenantContext;
    @Autowired OutboxRepository outboxRepository;

    UUID tenantId;
    UUID ownBranch;
    UUID foreignBranch;
    UUID cashierId;

    @BeforeEach
    void setUp() {
        outboxRepository.deleteAll();
        tenantId = UUID.randomUUID();
        ownBranch = UUID.randomUUID();
        foreignBranch = UUID.randomUUID();
        cashierId = UUID.randomUUID();
        // Verified JWT scope: this caller belongs to ownBranch only.
        tenantContext.set(tenantId, ownBranch, cashierId, null);
    }

    @Test
    void createOrder_foreignBranch_denied() {
        CreateOrderRequest req = new CreateOrderRequest(
                foreignBranch, UUID.randomUUID(), null, null, 1, null, null);

        assertThatThrownBy(() -> orderService.createOrder(req))
                .isInstanceOf(PermissionDeniedException.class);
    }

    @Test
    void createOrder_ownBranch_succeeds() {
        // Financial-integrity guard: an own-branch order needs an OPEN till for this cashier.
        openTillForCashier(ownBranch);
        CreateOrderRequest req = new CreateOrderRequest(
                ownBranch, UUID.randomUUID(), null, null, 1, null, null);

        OrderDto created = orderService.createOrder(req);

        assertThat(created.id()).isNotNull();
    }

    @Test
    void getOrder_foreignBranch_denied() {
        // Create a legitimate order under the caller's own branch first (needs an OPEN till).
        openTillForCashier(ownBranch);
        OrderDto created = orderService.createOrder(new CreateOrderRequest(
                ownBranch, UUID.randomUUID(), null, null, 1, null, null));

        // Re-reading it with a sibling branchId must be denied by the guard, not fall through
        // to a tenant-only repository lookup.
        assertThatThrownBy(() -> orderService.getOrder(created.id(), foreignBranch))
                .isInstanceOf(PermissionDeniedException.class);
    }

    @Test
    void openTill_foreignBranch_denied() {
        OpenTillRequest req = new OpenTillRequest(foreignBranch, 50000L);

        assertThatThrownBy(() -> tillService.openTill(req))
                .isInstanceOf(PermissionDeniedException.class);
    }

    @Test
    void openTill_ownBranch_succeeds() {
        TillSessionDto dto = tillService.openTill(new OpenTillRequest(ownBranch, 50000L));

        assertThat(dto.status().name()).isEqualTo("OPEN");
    }

    @Test
    void listTillsForBranch_foreignBranch_denied() {
        assertThatThrownBy(() -> tillService.listTillsForBranch(foreignBranch))
                .isInstanceOf(PermissionDeniedException.class);
    }
}
