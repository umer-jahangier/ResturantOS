package io.restaurantos.hr;

import io.restaurantos.hr.authz.HrAuthorizationService;
import io.restaurantos.shared.authz.AuthorizationService;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * HR configuration is authorised tenant-wide; everything operational stays branch-isolated.
 *
 * <h2>What is genuinely under test</h2>
 *
 * <p>These decisions come from a REAL OPA container running this repository's own {@code policies/}
 * bundle — {@code HrTestBase} wires it that way deliberately, because stubbing {@code OpaClient} to
 * return allow would prove only that HR calls <em>something</em>. {@code hr.rego} was correct in
 * isolation for a whole phase while nothing consulted it; what needs proving is the wiring.
 *
 * <p>{@code HrTestBase} grants every {@code hr.*} permission to the test principal, so a denial can
 * only ever come from tenant or branch SCOPING. Where a test here needs a caller who lacks a
 * permission, it installs a narrower principal explicitly and says so.
 *
 * <h2>The cross-branch allow is the point, not an oversight</h2>
 *
 * <p>{@link #configIsAllowedAcrossBranchesDeliberately} asserts a cross-branch ALLOW, which reads
 * like a hole in an HR policy until you know why. An owner's token carries exactly one branch. If
 * configuration were branch-scoped, that owner could edit the department list only while switched
 * to whichever branch they happened to be viewing, and a four-branch tenant would end up with four
 * drifting department lists — the very defect this phase exists to remove, one level up.
 */
class HrConfigAuthorizationIT extends HrTestBase {

    @Autowired HrAuthorizationService authorization;
    @Autowired AuthorizationService authorizationService;
    @Autowired TenantContext tenantContext;

    @Test
    @DisplayName("a caller in the resource's tenant holding the permission may view and manage config")
    void configViewAndManageAllowedForTheTenantsOwnCaller() {
        UUID tenant = UUID.randomUUID();
        tenantContext.set(tenant, UUID.randomUUID(), UUID.randomUUID(), null);
        try {
            assertThatCode(() -> authorization.authorizeConfigView(tenant)).doesNotThrowAnyException();
            assertThatCode(() -> authorization.authorizeConfigManage(tenant)).doesNotThrowAnyException();
        } finally {
            tenantContext.clear();
        }
    }

    /**
     * The behaviour 35-03 deliberately introduces. Named so a future reader does not "fix" it.
     */
    @Test
    @DisplayName("config is allowed across branches ON PURPOSE — an owner has one branch in their token")
    void configIsAllowedAcrossBranchesDeliberately() {
        UUID tenant = UUID.randomUUID();
        UUID callersBranch = UUID.randomUUID();
        tenantContext.set(tenant, callersBranch, UUID.randomUUID(), null);
        try {
            // The config methods take no branch at all, so there is no branch to mismatch. The
            // assertion that matters is the contrast below: the SAME caller, in the SAME context,
            // is refused an operational action against another branch.
            assertThatCode(() -> authorization.authorizeConfigManage(tenant)).doesNotThrowAnyException();

            UUID someOtherBranch = UUID.randomUUID();
            assertThatThrownBy(() -> authorization.authorizeEmployeeManage(tenant, someOtherBranch))
                    .as("phase 18b's branch isolation must be untouched — if this stops throwing, "
                            + "35-03 loosened something it was explicitly forbidden to loosen")
                    .isInstanceOf(PermissionDeniedException.class);
        } finally {
            tenantContext.clear();
        }
    }

    @Test
    @DisplayName("a caller from another tenant is denied both config actions")
    void crossTenantConfigIsDenied() {
        UUID callersTenant = UUID.randomUUID();
        UUID someoneElsesTenant = UUID.randomUUID();
        tenantContext.set(callersTenant, UUID.randomUUID(), UUID.randomUUID(), null);
        try {
            assertThatThrownBy(() -> authorization.authorizeConfigView(someoneElsesTenant))
                    .isInstanceOf(PermissionDeniedException.class);
            assertThatThrownBy(() -> authorization.authorizeConfigManage(someoneElsesTenant))
                    .as("dropping the branch predicate was a scoping decision; dropping the tenant "
                            + "predicate would be a cross-tenant read of another business's tax table")
                    .isInstanceOf(PermissionDeniedException.class);
        } finally {
            tenantContext.clear();
        }
    }

    /**
     * The separation of the two codes is the entire reason there are two of them: a manager must be
     * able to read the department list to fill an employee form, without thereby being able to
     * rewrite the income-tax table.
     */
    @Test
    @DisplayName("holding only hr.config.view is not enough to manage config")
    void viewPermissionDoesNotGrantManage() {
        UUID tenant = UUID.randomUUID();
        UUID branch = UUID.randomUUID();
        tenantContext.set(tenant, branch, UUID.randomUUID(), null);
        try {
            // Narrower principal than HrTestBase installs: read-only on config, like a MANAGER.
            withPermissions(tenant, branch, List.of("hr.config.view", "hr.employee.view"));

            assertThatCode(() -> authorization.authorizeConfigView(tenant)).doesNotThrowAnyException();
            assertThatThrownBy(() -> authorization.authorizeConfigManage(tenant))
                    .as("a caller who may read the lists must not thereby be able to edit the tax table")
                    .isInstanceOf(PermissionDeniedException.class);
        } finally {
            SecurityContextHolder.clearContext();
            tenantContext.clear();
        }
    }

    @Test
    @DisplayName("the denial comes from the policy, not from a repository WHERE clause")
    void denialOriginatesFromThePolicy() {
        UUID callersTenant = UUID.randomUUID();
        tenantContext.set(callersTenant, UUID.randomUUID(), UUID.randomUUID(), null);
        try {
            // No repository is involved in this call at all — authorizeConfigView touches only
            // AuthorizationService and the OPA container. A refusal here therefore cannot have come
            // from a query that returned no rows, which is the failure mode that makes an
            // authorization test meaningless.
            assertThatThrownBy(() -> authorization.authorizeConfigView(UUID.randomUUID()))
                    .isInstanceOf(PermissionDeniedException.class);

            // And the same OPA round trip returns ALLOW for the caller's own tenant, so the denial
            // above is a decision rather than a blanket failure of the policy transport.
            assertThatCode(() -> authorization.authorizeConfigView(callersTenant))
                    .doesNotThrowAnyException();
        } finally {
            tenantContext.clear();
        }
    }

    @Test
    @DisplayName("hr.config.view and hr.config.manage are in the test principal's permission set")
    void configPermissionsAreInTheCatalogUsedByTheseTests() {
        assertThat(ALL_HR_PERMISSIONS)
                .as("if these are absent, every allow above passes for the wrong reason")
                .contains("hr.config.view", "hr.config.manage");
    }

    /** Installs a principal holding exactly the given permissions, replacing HrTestBase's. */
    private static void withPermissions(UUID tenantId, UUID branchId, List<String> permissions) {
        // The 7-arg constructor fails closed on totpVerified, which is correct for a test principal.
        JwtClaims claims = new JwtClaims(
                UUID.randomUUID(), tenantId, branchId,
                List.of("MANAGER"), permissions, Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
    }
}
