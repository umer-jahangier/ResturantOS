package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderType;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.OpenTillRequest;
import io.restaurantos.pos.feign.UserBranchClient;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.support.ActiveBranchGuard;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.exception.StateInvalidException;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The Branches screen's deactivate dialog says, verbatim: <i>"It leaves everyone's branch switcher,
 * so nobody can take an order or start a till there."</i> This is the second clause.
 *
 * <h3>The defect these tests were written against</h3>
 *
 * <p>Measured against the running fleet on 2026-08-12 as {@code owner@terrace.local}: create branch
 * "Repro Probe 29240", switch onto it, deactivate it while standing on it, then — with the token the
 * app was still sending —
 *
 * <pre>
 *   POST /api/v1/pos/tills   -> HTTP 201   (till a2b9a57f-… opened on a retired branch)
 *   POST /api/v1/pos/orders  -> HTTP 201   (order 2731627c-… created on a retired branch)
 * </pre>
 *
 * <p>{@code GET /api/v1/branches/mine} had already correctly dropped the branch, so the shell could
 * not name where the user was and the work went on regardless. Both service methods called
 * {@code requireOwnBranch}, which compares the request's branchId against the JWT branch claim —
 * "is this YOUR branch", never "is this branch open".
 *
 * <h3>Why each test here can actually fail</h3>
 *
 * <p>Each refusal test is paired with the SAME call on an ACTIVE branch, in the same fixture, using
 * the same fixture path. Without the pair, a test asserting "this throws" passes just as well when
 * the guard is refusing everything — including for a reason that has nothing to do with the branch,
 * such as the fail-closed path firing because the mock returned null. The pair is the control.
 */
class DeactivatedBranchRefusesWorkIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired TenantContext tenantContext;

    private UUID tenantId;
    private UUID branchId;
    private UUID cashierId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        cashierId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, cashierId, null);

        when(opaClient.evaluate(any(), any())).thenReturn(new OpaDecision(true));

        // @RequiresFeature("FEATURE_POS") reads its answer from the (mocked) Redis cache; left
        // unstubbed every request dies in the aspect before reaching the service.
        @SuppressWarnings("unchecked")
        ValueOperations<String, String> valueOps = mock(ValueOperations.class);
        when(stringRedisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.get(anyString())).thenReturn("true");

        setSecurityContext();
    }

    /** user-service's answer for a branch an administrator has deactivated. */
    private void branchIsDeactivated() {
        when(userBranchClient.getBranchStatus(any(), any()))
                .thenReturn(new UserBranchClient.BranchStatus(branchId, false, false));
    }

    /** The PosTestBase default, restated here so each test names the world it runs in. */
    private void branchIsActive() {
        when(userBranchClient.getBranchStatus(any(), any()))
                .thenReturn(new UserBranchClient.BranchStatus(branchId, true, false));
    }

    // ── "nobody can ... start a till there" ──────────────────────────────────────────────────

    @Test
    void openTill_isRefusedOnADeactivatedBranch() {
        branchIsDeactivated();

        assertThatThrownBy(() -> tillService.openTill(new OpenTillRequest(branchId, 100_000L)))
                .isInstanceOf(StateInvalidException.class)
                .hasMessageContaining("deactivated")
                .extracting(e -> ((StateInvalidException) e).getCode())
                .isEqualTo(ActiveBranchGuard.CODE);
    }

    /**
     * The control. If this one ever fails, the refusal above is proving nothing about branches.
     */
    @Test
    void openTill_succeedsOnAnActiveBranch() {
        branchIsActive();

        assertThatCode(() -> tillService.openTill(new OpenTillRequest(branchId, 100_000L)))
                .doesNotThrowAnyException();
    }

    // ── "nobody can take an order ... there" ─────────────────────────────────────────────────

    @Test
    void createOrder_isRefusedOnADeactivatedBranch() {
        branchIsDeactivated();

        assertThatThrownBy(() -> orderService.createOrder(newCheck()))
                .isInstanceOf(StateInvalidException.class)
                .hasMessageContaining("deactivated")
                .extracting(e -> ((StateInvalidException) e).getCode())
                .isEqualTo(ActiveBranchGuard.CODE);
    }

    /** The control for the order path. */
    @Test
    void createOrder_succeedsOnAnActiveBranch() {
        branchIsActive();

        assertThat(orderService.createOrder(newCheck()).branchId()).isEqualTo(branchId);
    }

    /**
     * A soft-deleted branch reads {@code deleted: true} even if {@code active} was never cleared.
     * user-service's {@code softDelete} sets both, but {@code deactivateInternal} and any future
     * writer are separate code paths — the guard must not depend on the two staying in step.
     */
    @Test
    void createOrder_isRefusedOnASoftDeletedBranchEvenIfItStillReadsActive() {
        when(userBranchClient.getBranchStatus(any(), any()))
                .thenReturn(new UserBranchClient.BranchStatus(branchId, true, true));

        assertThatThrownBy(() -> orderService.createOrder(newCheck()))
                .isInstanceOf(StateInvalidException.class)
                .extracting(e -> ((StateInvalidException) e).getCode())
                .isEqualTo(ActiveBranchGuard.CODE);
    }

    /**
     * FAIL CLOSED. A branch whose state cannot be established takes no orders.
     *
     * <p>This is the assertion that would quietly invert if someone "hardened" the guard by
     * catching the lookup failure and continuing — the change that turns a control into a comment.
     * The availability cost of this direction is real and is argued in {@link ActiveBranchGuard};
     * the point of the test is that reversing it must break something.
     */
    @Test
    void createOrder_isRefusedWhenTheBranchStateCannotBeEstablished() {
        when(userBranchClient.getBranchStatus(any(), any()))
                .thenThrow(new IllegalStateException("user-service unreachable"));

        assertThatThrownBy(() -> orderService.createOrder(newCheck()))
                .isInstanceOf(StateInvalidException.class)
                .extracting(e -> ((StateInvalidException) e).getCode())
                .isEqualTo(ActiveBranchGuard.CODE);
    }

    private CreateOrderRequest newCheck() {
        return new CreateOrderRequest(branchId, UUID.randomUUID(), OrderType.DINE_IN, null, 2, null, null);
    }

    private void setSecurityContext() {
        List<String> permissions = List.of(
                "pos.order.view", "pos.order.create", "pos.order.update",
                "pos.till.open", "pos.till.view", "pos.menu.view");
        JwtClaims claims = new JwtClaims(
                cashierId, tenantId, branchId,
                List.of("OWNER"), permissions, Map.of("approval_limit_paisa", 30_000_000L), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null,
                        permissions.stream().map(SimpleGrantedAuthority::new).toList()));
    }
}
