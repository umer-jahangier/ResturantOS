package io.restaurantos.pos;

import io.restaurantos.pos.dto.TillSessionDto;
import io.restaurantos.pos.service.TillService;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Till-ownership guard: the cashier-scoped {@code GET /api/v1/pos/tills?cashierId=…} lookup must
 * not let one cashier read a colleague's till session. Before the fix the client-supplied
 * {@code cashierId} went straight to {@code findByCashierIdAndStatus}, so any authenticated
 * principal in the tenant could read another user's opening float, expected/declared closing and
 * variance simply by knowing their user id (RLS is tenant-only and does not scope by subject).
 *
 * <p>Both principals here are ordinary CASHIERs in the SAME tenant and branch — the leak was never
 * a tenant- or branch-isolation failure, so those guards cannot catch it.
 */
class TillOwnershipGuardIT extends PosTestBase {

    @Autowired TillService tillService;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;
    /** The victim: an established cashier with an OPEN till holding real cash. */
    UUID victimCashierId;
    /** The attacker: a newly hired cashier — same tenant, same branch, same permissions. */
    UUID otherCashierId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        victimCashierId = UUID.randomUUID();
        otherCashierId = UUID.randomUUID();
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    /** Becomes {@code userId} for both the tenant context and the JWT principal. */
    private void actAs(UUID userId, String... permissions) {
        tenantContext.set(tenantId, branchId, userId, null);
        JwtClaims claims = new JwtClaims(
                userId, tenantId, branchId,
                List.of("CASHIER"), List.of(permissions),
                Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
    }

    /** Opens an OPEN till for {@code cashierId} and leaves the context switched to them. */
    private TillSessionDto openTillAs(UUID cashierId) {
        actAs(cashierId, "pos.till.open");
        return openTillForCashier(branchId);
    }

    @Test
    void foreignCashierId_isRefused() {
        TillSessionDto victimTill = openTillAs(victimCashierId);
        assertThat(victimTill.status().name()).isEqualTo("OPEN");

        // The whole finding, in one call: a plain CASHIER naming a colleague's user id.
        actAs(otherCashierId, "pos.till.open");

        assertThatThrownBy(() -> tillService.listTills(victimCashierId, "OPEN"))
                .isInstanceOf(PermissionDeniedException.class);
    }

    @Test
    void foreignCashierId_isRefusedRegardlessOfStatusFilter() {
        openTillAs(victimCashierId);
        actAs(otherCashierId, "pos.till.open");

        // The guard must not be reachable-around via the status parameter.
        assertThatThrownBy(() -> tillService.listTills(victimCashierId, "CLOSED"))
                .isInstanceOf(PermissionDeniedException.class);
        assertThatThrownBy(() -> tillService.listTills(victimCashierId, null))
                .isInstanceOf(PermissionDeniedException.class);
    }

    @Test
    void ownTill_isStillReadableWithExplicitCashierId() {
        TillSessionDto own = openTillAs(otherCashierId);

        List<TillSessionDto> result = tillService.listTills(otherCashierId, "OPEN");

        assertThat(result).hasSize(1);
        assertThat(result.get(0).id()).isEqualTo(own.id());
        assertThat(result.get(0).cashierId()).isEqualTo(otherCashierId);
    }

    @Test
    void ownTill_isStillReadableWithNoCashierId() {
        // What the POS active-till bar now sends: status only, no identity claim of its own.
        TillSessionDto own = openTillAs(otherCashierId);

        List<TillSessionDto> result = tillService.listTills(null, "OPEN");

        assertThat(result).hasSize(1);
        assertThat(result.get(0).id()).isEqualTo(own.id());
        assertThat(result.get(0).cashierId()).isEqualTo(otherCashierId);
    }

    @Test
    void noOpenTill_returnsEmptyRatherThanLeaking() {
        openTillAs(victimCashierId);
        // A cashier with no till of their own must get nothing — not fall back to anyone else's.
        actAs(otherCashierId, "pos.till.open");

        assertThat(tillService.listTills(null, "OPEN")).isEmpty();
    }

    @Test
    void foreignCashierId_isAllowedForTillReviewers() {
        TillSessionDto victimTill = openTillAs(victimCashierId);

        // A manager/owner holding pos.till.review keeps the named-cashier lookup.
        actAs(otherCashierId, "pos.till.open", "pos.till.review");

        List<TillSessionDto> result = tillService.listTills(victimCashierId, "OPEN");

        assertThat(result).hasSize(1);
        assertThat(result.get(0).id()).isEqualTo(victimTill.id());
        assertThat(result.get(0).cashierId()).isEqualTo(victimCashierId);
    }
}
