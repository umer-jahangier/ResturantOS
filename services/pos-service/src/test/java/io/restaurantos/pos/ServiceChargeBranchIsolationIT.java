package io.restaurantos.pos;

import io.restaurantos.pos.domain.model.BranchServiceCharge;
import io.restaurantos.pos.dto.ServiceChargeDtos.ServiceChargePolicyDto;
import io.restaurantos.pos.dto.ServiceChargeDtos.UpdateServiceChargeRequest;
import io.restaurantos.pos.repository.BranchServiceChargeRepository;
import io.restaurantos.pos.service.ServiceChargeService;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * {@code /branches/{branchId}/service-charge} must refuse a branch the caller does not hold.
 *
 * <h2>The defect this file exists to fail on</h2>
 *
 * <p>Proven live on 2026-08-12. Signed in as Control Bistro's OWNER and issued
 * {@code PUT /api/v1/pos/branches/34cd6f62-.../service-charge} — <b>Floating Terrace HQ's</b>
 * branch id — at 25% labelled {@code HIJACKED}. The API answered <b>200</b>, echoing the saved
 * policy with {@code canManage:true}, and {@code branch_service_charge} then held a row carrying
 * Control Bistro's {@code tenant_id} beside Floating Terrace's {@code branch_id}. Neither
 * {@code ServiceChargeServiceImpl.get} nor {@code .update} looked at the branch at all: both took
 * the path variable and went straight to {@code findByTenantIdAndBranchId}.
 *
 * <h2>What the severity actually is — stated precisely, because it is easy to overstate</h2>
 *
 * <p>This was <b>not</b> a data leak and <b>not</b> a pricing hijack, and these tests are written
 * so that nobody later reads them as proof of one:
 *
 * <ul>
 *   <li>The victim kept billing its own rate. {@code policyFor} reads by
 *       {@code (tenantId, branchId)}, so Terrace's checks still found Terrace's 5% row — asserted
 *       in {@link #aForeignBranchCannotBeWrittenAndTheRealOwnersRateIsUntouched}.</li>
 *   <li>The attacker never billed the forged rate either: their own branches never matched a row
 *       keyed to someone else's branch id. The write was <b>inert</b>.</li>
 *   <li>The read leaked nothing. A foreign branch returned a <i>synthesised</i> "unconfigured"
 *       policy — the DTO's zero-defaults, not the other tenant's row.</li>
 * </ul>
 *
 * <p>So the defect is narrower and more specific: <b>the API reported success for a write that
 * could never take effect</b>, and {@code branch_service_charge} silently accumulated orphans.
 * The live table already carried a {@code Bogus branch charge} row at 99% against branch
 * {@code 00000000-0000-4000-8000-000000000999}, which exists nowhere in the fleet — the fixed
 * id below is that row, kept as the regression's fingerprint.
 *
 * <h2>Falsification — how each test was watched to fail</h2>
 *
 * <p>Delete the two {@code requireOwnBranch(branchId)} calls from
 * {@code ServiceChargeServiceImpl.get} and {@code .update} — the entire production fix — and:
 *
 * <ul>
 *   <li>both GET tests fail on the missing throw, returning the unconfigured DTO instead;</li>
 *   <li>both PUT tests fail the same way, and their orphan-row assertions then find the row the
 *       live probe found;</li>
 *   <li>{@link #theCallersOwnBranchStillReadsAndWritesNormally} keeps passing — it is the positive
 *       control, and it is what stops "404 on everything" from counting as a fix.</li>
 * </ul>
 */
class ServiceChargeBranchIsolationIT extends PosTestBase {

    @Autowired ServiceChargeService serviceChargeService;
    @Autowired BranchServiceChargeRepository serviceChargeRepository;
    @Autowired TenantContext tenantContext;

    /** The tenant that owns the branch, and actually takes 5% at it. "Floating Terrace". */
    private UUID victimTenantId;
    private UUID victimBranchId;

    /** The tenant doing the asking, holding OWNER at its own, different branch. "Control Bistro". */
    private UUID attackerTenantId;
    private UUID attackerBranchId;

    /**
     * The id from the live {@code Bogus branch charge} orphan — a branch that exists nowhere.
     * Fixed rather than random so a future reader can match it to the row in the incident note.
     */
    private static final UUID BRANCH_THAT_EXISTS_NOWHERE =
            UUID.fromString("00000000-0000-4000-8000-000000000999");

    private static final BigDecimal VICTIMS_REAL_RATE = new BigDecimal("5.00");

    @BeforeEach
    void setUp() {
        victimTenantId = UUID.randomUUID();
        victimBranchId = UUID.randomUUID();
        attackerTenantId = UUID.randomUUID();
        attackerBranchId = UUID.randomUUID();

        // The victim configures its own branch, legitimately, as its own owner.
        signInAsOwner(victimTenantId, victimBranchId);
        serviceChargeService.update(victimBranchId, new UpdateServiceChargeRequest(
                true, VICTIMS_REAL_RATE, "Service charge", true, false, false));

        // Everything below is asked as the other tenant's owner.
        signInAsOwner(attackerTenantId, attackerBranchId);
    }

    // ── (a) a branch belonging to another tenant ──────────────────────────────────────────────

    /**
     * The GET half. It must be an absence, not the synthesised "unconfigured" policy the old code
     * answered — that shape told a prober "this branch is real and takes nothing", which is both
     * false and more than they are owed.
     */
    @Test
    void aForeignTenantsBranchReadsAsAbsentRatherThanAsAnUnconfiguredPolicy() {
        assertThatThrownBy(() -> serviceChargeService.get(victimBranchId))
                .as("another tenant's branch must read as NOT FOUND — never 403, never a row")
                .isInstanceOf(ResourceNotFoundException.class);
    }

    /**
     * The PUT half, and the one that reproduces the live probe exactly.
     *
     * <p>Three separate claims, because the refusal alone is the weakest of them: the call is
     * refused, no orphan row is left behind under the caller's tenant, and — the claim that
     * bounds the severity — the branch's real owner still has its 5%.
     */
    @Test
    void aForeignBranchCannotBeWrittenAndTheRealOwnersRateIsUntouched() {
        assertThatThrownBy(() -> serviceChargeService.update(victimBranchId,
                new UpdateServiceChargeRequest(
                        true, new BigDecimal("25.00"), "HIJACKED", true, true, true)))
                .as("the exact call that answered 200 live on 2026-08-12")
                .isInstanceOf(ResourceNotFoundException.class);

        assertThat(serviceChargeRepository.findByTenantIdAndBranchId(attackerTenantId, victimBranchId))
                .as("no orphan row: this is the row the live probe created, keyed to the caller's "
                        + "tenant and someone else's branch, readable by nobody")
                .isEmpty();

        // Asserted while signed in AS the victim, so the claim holds whether or not RLS is
        // filtering this connection — reading another tenant's row from the attacker's session
        // would prove nothing about what is stored.
        signInAsOwner(victimTenantId, victimBranchId);
        Optional<BranchServiceCharge> owners =
                serviceChargeRepository.findByTenantIdAndBranchId(victimTenantId, victimBranchId);
        assertThat(owners).isPresent();
        assertThat(owners.get().getRatePct())
                .as("the branch's real owner keeps billing its own rate — the write was inert, "
                        + "which is why this was never a pricing hijack")
                .isEqualByComparingTo(VICTIMS_REAL_RATE);
        assertThat(owners.get().getLabel()).isEqualTo("Service charge");
    }

    // ── (b) a branch id that exists nowhere ───────────────────────────────────────────────────

    /** No tenant owns it, so no tenant may read it — including one that owns no branch like it. */
    @Test
    void aBranchIdThatExistsNowhereReadsAsAbsent() {
        assertThatThrownBy(() -> serviceChargeService.get(BRANCH_THAT_EXISTS_NOWHERE))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    /**
     * The one that would have prevented the live {@code Bogus branch charge} row at 99%. The
     * refusal matters less than the emptiness after it: an accepted write here is a row no query
     * in the system can ever reach again.
     */
    @Test
    void aBranchIdThatExistsNowhereCannotBeWrittenAndLeavesNothingBehind() {
        assertThatThrownBy(() -> serviceChargeService.update(BRANCH_THAT_EXISTS_NOWHERE,
                new UpdateServiceChargeRequest(
                        true, new BigDecimal("99.00"), "Bogus branch charge", true, true, true)))
                .isInstanceOf(ResourceNotFoundException.class);

        assertThat(serviceChargeRepository
                .findByTenantIdAndBranchId(attackerTenantId, BRANCH_THAT_EXISTS_NOWHERE))
                .as("the orphan this endpoint used to accumulate")
                .isEmpty();
    }

    // ── the positive control ──────────────────────────────────────────────────────────────────

    /**
     * Without this, a fix that refused every branch would pass every test above.
     *
     * <p>This codebase's named failure is the control that is structurally present and
     * behaviourally absent; the mirror of it is a control so blunt it breaks the feature while the
     * suite stays green. The caller's OWN branch must still read as unconfigured and still accept
     * a write.
     */
    @Test
    void theCallersOwnBranchStillReadsAndWritesNormally() {
        ServiceChargePolicyDto beforeAnyWrite = serviceChargeService.get(attackerBranchId);
        assertThat(beforeAnyWrite.enabled())
                .as("the caller's own, unconfigured branch still answers a policy rather than a 404")
                .isFalse();
        assertThat(beforeAnyWrite.canManage()).isTrue();

        ServiceChargePolicyDto saved = serviceChargeService.update(attackerBranchId,
                new UpdateServiceChargeRequest(
                        true, new BigDecimal("7.50"), "Service charge", true, false, false));
        assertThat(saved.ratePct()).isEqualByComparingTo("7.50");

        assertThat(serviceChargeService.get(attackerBranchId).ratePct())
                .as("and it reads back")
                .isEqualByComparingTo("7.50");
    }

    // ── helpers ───────────────────────────────────────────────────────────────────────────────

    /**
     * An OWNER of {@code branchId} at {@code tenantId}, holding BOTH service-charge codes.
     *
     * <p>Holding them is what makes these tests about branch ownership rather than about
     * permissions: {@code get} checks {@code pos.menu.view} and {@code update} checks
     * {@code pos.service_charge.manage} BEFORE the branch, so a persona missing either would throw
     * {@code PermissionDeniedException} and every assertion below would pass for the wrong reason.
     */
    private void signInAsOwner(UUID tenantId, UUID branchId) {
        UUID userId = UUID.randomUUID();
        JwtClaims claims = new JwtClaims(userId, tenantId, branchId, List.of("OWNER"),
                List.of("pos.menu.view", "pos.service_charge.manage"), Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
        tenantContext.set(tenantId, branchId, userId, null);
    }
}
