package io.restaurantos.auth.service;

import io.restaurantos.auth.entity.UserBranchRoleEntity;
import io.restaurantos.auth.repository.RolePermissionRepository;
import io.restaurantos.auth.repository.UserBranchRoleRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The branch-selection half of {@link PermissionResolver}, without a database.
 *
 * <p>Two of these cases cannot be written as integration tests any more, and that is the point: the
 * partial unique index makes a second active row per branch impossible to create, so the resolver's
 * behaviour when it sees one is only reachable through a stubbed repository. The behaviour still
 * has to be right. A row that predates the index, arrives through a repair script, or survives a
 * future migration that drops it must produce a login and a warning, not
 * {@code IncorrectResultSizeDataAccessException} on the credential path.
 */
class PermissionResolverTest {

    private static final UUID USER = UUID.fromString("c0000001-0000-4000-8000-000000000001");
    private static final UUID BRANCH_LOW = UUID.fromString("b0000001-0000-4000-8000-000000000001");
    private static final UUID BRANCH_HIGH = UUID.fromString("b0000009-0000-4000-8000-000000000009");

    private UserBranchRoleRepository assignments;
    private PermissionResolver resolver;

    @BeforeEach
    void setUp() {
        assignments = mock(UserBranchRoleRepository.class);
        RolePermissionRepository permissions = mock(RolePermissionRepository.class);
        when(permissions.findPermissionCodesByRoleCodes(anyList())).thenReturn(List.of("pos.order.create"));
        resolver = new PermissionResolver(assignments, permissions);
    }

    // ── Resolving at a named branch ───────────────────────────────────────────

    @Test
    void aSurplusActiveRowDegradesToADeterministicPickInsteadOfThrowing() {
        UserBranchRoleEntity higherId = row("00000000-0000-4000-8000-0000000000ff", BRANCH_LOW, "MANAGER");
        UserBranchRoleEntity lowerId = row("00000000-0000-4000-8000-000000000001", BRANCH_LOW, "CASHIER");
        when(assignments.findByUserIdAndBranchIdAndActiveTrue(USER, BRANCH_LOW))
                .thenReturn(List.of(higherId, lowerId));

        ResolvedBranchAuth resolved = resolver.resolve(USER, BRANCH_LOW);

        assertThat(resolved.roles())
                .as("lowest assignment id, so two nodes resolving the same stale row agree — and "
                        + "above all, a login rather than a 500")
                .containsExactly("CASHIER");
    }

    @Test
    void noAssignmentAtTheRequestedBranchNamesTheUserAndTheBranch() {
        when(assignments.findByUserIdAndBranchIdAndActiveTrue(USER, BRANCH_HIGH)).thenReturn(List.of());

        assertThatThrownBy(() -> resolver.resolve(USER, BRANCH_HIGH))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining(USER.toString())
                .hasMessageContaining(BRANCH_HIGH.toString());
    }

    // ── Selecting the default branch ──────────────────────────────────────────

    @Test
    void theDefaultBranchIsThePrimaryOneEvenWhenItIsNotTheLowestBranchId() {
        UserBranchRoleEntity low = row("00000000-0000-4000-8000-000000000001", BRANCH_LOW, "CASHIER");
        UserBranchRoleEntity high = row("00000000-0000-4000-8000-000000000002", BRANCH_HIGH, "WAITER");
        high.setPrimary(true);
        when(assignments.findByUserIdAndActiveTrue(USER)).thenReturn(List.of(low, high));

        assertThat(resolver.resolveDefault(USER).branchId())
                .as("the old code preferred a hardcoded HQ UUID and otherwise the lowest branch id; "
                        + "both would answer b0000001 here")
                .isEqualTo(BRANCH_HIGH);
    }

    @Test
    void withNoPrimaryTheDefaultBranchIsTheLowestBranchId() {
        UserBranchRoleEntity high = row("00000000-0000-4000-8000-000000000001", BRANCH_HIGH, "WAITER");
        UserBranchRoleEntity low = row("00000000-0000-4000-8000-000000000002", BRANCH_LOW, "CASHIER");
        when(assignments.findByUserIdAndActiveTrue(USER)).thenReturn(List.of(high, low));

        assertThat(resolver.resolveDefault(USER).branchId())
                .as("a user whose rows predate the is_primary backfill still has to be able to log "
                        + "in, and has to land on the same branch every time")
                .isEqualTo(BRANCH_LOW);
    }

    @Test
    void noActiveAssignmentsAtAllNamesTheUserWhoIsLockedOut() {
        when(assignments.findByUserIdAndActiveTrue(USER)).thenReturn(List.of());

        assertThatThrownBy(() -> resolver.resolveDefault(USER))
                .isInstanceOf(IllegalStateException.class)
                .as("the message used to be 'User has no active branch assignments' with no id, "
                        + "which gave an operator no way to tell who could not log in")
                .hasMessageContaining(USER.toString());
    }

    @Test
    void approvalLimitIsCarriedIntoTheAttributesWhenSet() {
        UserBranchRoleEntity only = row("00000000-0000-4000-8000-000000000001", BRANCH_LOW, "CASHIER");
        only.setApprovalLimitPaisa(5_000_000L);
        when(assignments.findByUserIdAndActiveTrue(USER)).thenReturn(List.of(only));

        assertThat(resolver.resolveDefault(USER).attributes())
                .as("pos.rego compares a refund against approval_limit_paisa; dropping it silently "
                        + "denies every refund")
                .containsEntry("approval_limit_paisa", 5_000_000L);
    }

    private static UserBranchRoleEntity row(String id, UUID branchId, String roleCode) {
        UserBranchRoleEntity e = new UserBranchRoleEntity();
        e.setId(UUID.fromString(id));
        e.setUserId(USER);
        e.setBranchId(branchId);
        e.setRoleCode(roleCode);
        e.setActive(true);
        return e;
    }
}
