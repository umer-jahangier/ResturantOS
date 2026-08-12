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
    void foreignCashierId_isRefused_whileOwnerStillSeesTheSameRow() {
        TillSessionDto victimTill = openTillAs(victimCashierId);

        // POSITIVE CONTROL (KdsAccessIsolationIT's rule): prove the owner CAN read the exact row
        // we are about to prove the colleague cannot. Without this, the denial below would also
        // pass if the row were missing, RLS hid everything, or the status filter never matched —
        // i.e. the isolation assertion could be green while enforcing nothing.
        List<TillSessionDto> ownerView = tillService.listTills(victimCashierId, "OPEN");
        assertThat(ownerView).hasSize(1);
        assertThat(ownerView.get(0).id()).isEqualTo(victimTill.id());
        assertThat(ownerView.get(0).openingFloatPaisa()).isEqualTo(victimTill.openingFloatPaisa());

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

        // A manager/owner holding pos.till.review keeps the named-cashier lookup — the cash-up
        // flow depends on it, so the ownership guard must not break it.
        actAs(otherCashierId, "pos.till.open", "pos.till.review");

        List<TillSessionDto> result = tillService.listTills(victimCashierId, "OPEN");

        assertThat(result).hasSize(1);
        assertThat(result.get(0).id()).isEqualTo(victimTill.id());
        assertThat(result.get(0).cashierId()).isEqualTo(victimCashierId);
    }

    @Test
    void tillReviewer_cannotReachAnotherBranch() {
        TillSessionDto victimTill = openTillAs(victimCashierId);

        // Positive control: in-branch, this reviewer CAN read the row.
        actAs(otherCashierId, "pos.till.open", "pos.till.review");
        assertThat(tillService.listTills(victimCashierId, "OPEN")).hasSize(1);

        // Same reviewer, same tenant, same permission — but scoped to a sibling branch.
        // pos.till.review must not silently become a tenant-wide read.
        UUID siblingBranch = UUID.randomUUID();
        tenantContext.set(tenantId, siblingBranch, otherCashierId, null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(
                        new JwtClaims(otherCashierId, tenantId, siblingBranch,
                                List.of("MANAGER"), List.of("pos.till.open", "pos.till.review"),
                                Map.of(), null),
                        null, List.of()));

        assertThat(tillService.listTills(victimCashierId, "OPEN")).isEmpty();
        assertThat(victimTill.branchId()).isEqualTo(branchId);
    }

    @Test
    void branchPath_isNotAnEscapeHatchAroundTheOwnershipGuard() {
        TillSessionDto victimTill = openTillAs(victimCashierId);

        actAs(otherCashierId, "pos.till.open");

        // Refused by the ownership guard...
        assertThatThrownBy(() -> tillService.listTills(victimCashierId, "OPEN"))
                .isInstanceOf(PermissionDeniedException.class);

        // ...and must ALSO be refused by the branch-wide path, which returns strictly more (every
        // till in the branch, including the one just denied). Without this the guard above is
        // decorative: the same cashier asks ?branchId=<own> instead and gets the colleague's row.
        assertThatThrownBy(() -> tillService.listTillsForBranch(branchId))
                .isInstanceOf(PermissionDeniedException.class);

        assertThat(victimTill.cashierId()).isEqualTo(victimCashierId);
    }

    @Test
    void branchPath_stillWorksForTheManagerCashUpFlow() {
        TillSessionDto victimTill = openTillAs(victimCashierId);

        // The live till-review page gates on pos.order.view.all, so a manager holding it must keep
        // working — closing the leak must not break cash-up.
        actAs(otherCashierId, "pos.order.view.all");
        List<TillSessionDto> viaIncumbent = tillService.listTillsForBranch(branchId);
        assertThat(viaIncumbent).extracting(TillSessionDto::id).contains(victimTill.id());

        // And the intended end-state permission works on its own.
        actAs(otherCashierId, "pos.till.review");
        List<TillSessionDto> viaTillReview = tillService.listTillsForBranch(branchId);
        assertThat(viaTillReview).extracting(TillSessionDto::id).contains(victimTill.id());
    }

    @Test
    void tillReviewer_cannotReachAnotherTenant() {
        TillSessionDto victimTill = openTillAs(victimCashierId);

        // A reviewer in a DIFFERENT restaurant must not read this tenant's till. RLS is the only
        // enforced tenant boundary in this product, and Testcontainers connects as a SUPERUSER
        // (which bypasses FORCE RLS) — so this asserts the in-app tenant predicate, which is what
        // actually holds the line when RLS is bypassed or tenant context is wrong.
        UUID foreignTenant = UUID.randomUUID();
        tenantContext.set(foreignTenant, branchId, otherCashierId, null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(
                        new JwtClaims(otherCashierId, foreignTenant, branchId,
                                List.of("OWNER"), List.of("pos.till.open", "pos.till.review"),
                                Map.of(), null),
                        null, List.of()));

        assertThat(tillService.listTills(victimCashierId, "OPEN")).isEmpty();
        assertThat(victimTill.id()).isNotNull();
    }
}
