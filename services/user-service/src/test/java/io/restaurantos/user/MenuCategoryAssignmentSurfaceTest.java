package io.restaurantos.user;

import io.restaurantos.user.client.AuthInternalClient;
import io.restaurantos.user.controller.UserAdminController;
import io.restaurantos.user.dto.BranchDtos;
import io.restaurantos.user.service.UserAdminService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;

import java.lang.reflect.Method;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The public menu-scope surface: its GATE and its DELEGATION (Program A).
 *
 * <h2>Why the gate is asserted by reflection against its SIBLING</h2>
 *
 * The brief for this work said it plainly: match the permission the existing endpoints use, do not
 * invent a second rule, and do not widen anything. Asserting the literal string
 * {@code "hasAnyAuthority('rbac.manage','rbac.role.manage')"} would pin today's spelling and would
 * pass a later commit that widened BOTH endpoints together. Asserting EQUALITY WITH THE STATION
 * PAIR pins the actual requirement — these two decisions are made in one dialog and must always be
 * reachable by exactly the same people — and it stays true through a rename.
 *
 * <p>It also catches the failure that has no other detector: a {@code @PreAuthorize} omitted
 * entirely. An ungated write here is not a small mistake — it would let anyone who can reach the
 * gateway confine any cashier in their tenant to a section of the menu, mid-service.
 *
 * <h2>Why the delegation is asserted at all</h2>
 *
 * user-service is a PROXY for this feature: auth-service owns
 * {@code user_menu_category_assignments} and mints the claim from it. The bug this catches is the
 * one that costs a day — a proxy that drops {@code X-Tenant-Id}. auth-service accepts the request,
 * the RLS GUC is never set, every read matches zero rows, and the caller is told the user has no
 * assignments about a user whose assignments were present the whole time. That exact failure is
 * already recorded in {@code AuthInternalController.getUserPermissions}'s javadoc, on this same
 * client, for this same reason. Testcontainers cannot see it — its Postgres user is a superuser and
 * superusers bypass row security — so it is pinned here, on the wire, instead.
 */
class MenuCategoryAssignmentSurfaceTest {

    private static final UUID TENANT = UUID.fromString("d108c2e6-a70d-49c8-acdc-37531fd752d8");
    private static final UUID USER = UUID.fromString("eb2ee67e-9fc0-4ed5-bb5b-cd6321e02ba1");
    private static final UUID BRANCH = UUID.fromString("34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03");
    private static final UUID DRINKS = UUID.fromString("dee4c746-68c0-441b-9292-e76e03753e45");

    // ── The gate ─────────────────────────────────────────────────────────────────────────────

    @Test
    void theMenuCategoryWriteIsGatedExactlyAsTheStationWriteIs() throws Exception {
        Method menu = UserAdminController.class.getMethod(
            "replaceMenuCategories", UUID.class, BranchDtos.MenuCategoryAssignmentRequest.class);
        Method station = UserAdminController.class.getMethod(
            "replaceStations", UUID.class, BranchDtos.StationAssignmentRequest.class);

        assertThat(menu.getAnnotation(PreAuthorize.class))
            .as("an ungated menu-scope write lets anyone who can reach the gateway confine any "
                    + "cashier in their tenant, mid-service")
            .isNotNull();
        assertThat(menu.getAnnotation(PreAuthorize.class).value())
            .as("the same authority as the station write it sits beside in one dialog — not a "
                    + "second rule, and not a wider one")
            .isEqualTo(station.getAnnotation(PreAuthorize.class).value());
        assertThat(menu.getAnnotation(PutMapping.class).value())
            .containsExactly("/{userId}/menu-categories");
    }

    @Test
    void theMenuCategoryReadIsGatedExactlyAsTheStationReadIs() throws Exception {
        Method menu = UserAdminController.class.getMethod("listMenuCategories", UUID.class);
        Method station = UserAdminController.class.getMethod("listStations", UUID.class);

        assertThat(menu.getAnnotation(PreAuthorize.class)).isNotNull();
        assertThat(menu.getAnnotation(PreAuthorize.class).value())
            .isEqualTo(station.getAnnotation(PreAuthorize.class).value());
        assertThat(menu.getAnnotation(GetMapping.class).value())
            .containsExactly("/{userId}/menu-categories");
    }

    @Test
    void theWriteIsGatedMoreNarrowlyThanTheRead() throws Exception {
        // The control that gives the two assertions above their meaning: if every method on this
        // controller carried one identical annotation, "equal to its sibling" would be free.
        String write = UserAdminController.class
            .getMethod("replaceMenuCategories", UUID.class,
                BranchDtos.MenuCategoryAssignmentRequest.class)
            .getAnnotation(PreAuthorize.class).value();
        String read = UserAdminController.class
            .getMethod("listMenuCategories", UUID.class)
            .getAnnotation(PreAuthorize.class).value();

        assertThat(write)
            .as("granting is the dangerous half — 13-02 split rbac.role.manage from "
                    + "rbac.user.manage precisely so a narrower custom role could read a user "
                    + "without being able to re-scope them")
            .isNotEqualTo(read);
        assertThat(write).contains("rbac.role.manage");
        assertThat(read).contains("rbac.user.manage");
    }

    // ── The delegation ───────────────────────────────────────────────────────────────────────

    @Test
    void theWriteCarriesTheTenantFromTheVERIFIEDJwtAndNotFromTheRequest() {
        AuthInternalClient client = mock(AuthInternalClient.class);
        TenantContext ctx = mock(TenantContext.class);
        when(ctx.requireTenantId()).thenReturn(TENANT);
        when(ctx.getUserId()).thenReturn(Optional.of(UUID.randomUUID()));

        BranchDtos.MenuCategoryAssignmentRequest request =
            new BranchDtos.MenuCategoryAssignmentRequest(BRANCH, List.of(DRINKS));
        new UserAdminService(client, ctx).replaceMenuCategories(USER, request);

        ArgumentCaptor<UUID> tenant = ArgumentCaptor.forClass(UUID.class);
        verify(client).replaceMenuCategories(eq(USER), tenant.capture(), any());
        assertThat(tenant.getValue())
            .as("X-Tenant-Id is what puts the RLS GUC on auth-service's connection. Drop it and "
                    + "every read matches zero rows and reports a scoped user as unassigned.")
            .isEqualTo(TENANT);
    }

    @Test
    void anEmptyCategoryListReachesAuthServiceUNCHANGED() {
        AuthInternalClient client = mock(AuthInternalClient.class);
        TenantContext ctx = mock(TenantContext.class);
        when(ctx.requireTenantId()).thenReturn(TENANT);

        new UserAdminService(client, ctx).replaceMenuCategories(
            USER, new BranchDtos.MenuCategoryAssignmentRequest(BRANCH, List.of()));

        ArgumentCaptor<BranchDtos.MenuCategoryAssignmentRequest> body =
            ArgumentCaptor.forClass(BranchDtos.MenuCategoryAssignmentRequest.class);
        verify(client).replaceMenuCategories(eq(USER), eq(TENANT), body.capture());
        assertThat(body.getValue().categoryIds())
            .as("an empty list is the ONLY way to return a user to the whole menu. A proxy that "
                    + "'helpfully' skipped it would make a restriction permanent.")
            .isEmpty();
        assertThat(body.getValue().branchId()).isEqualTo(BRANCH);
    }

    @Test
    void theReadCarriesTheTenantToo() {
        AuthInternalClient client = mock(AuthInternalClient.class);
        TenantContext ctx = mock(TenantContext.class);
        when(ctx.requireTenantId()).thenReturn(TENANT);
        when(client.listMenuCategories(USER, TENANT))
            .thenReturn(List.of(new BranchDtos.MenuCategoryAssignment(BRANCH, List.of(DRINKS))));

        List<BranchDtos.MenuCategoryAssignment> out =
            new UserAdminService(client, ctx).listMenuCategories(USER);

        verify(client).listMenuCategories(USER, TENANT);
        assertThat(out).singleElement()
            .satisfies(a -> {
                assertThat(a.branchId()).isEqualTo(BRANCH);
                assertThat(a.categoryIds()).containsExactly(DRINKS);
            });
    }

    // ── The wire contract with auth-service ──────────────────────────────────────────────────

    @Test
    void theFeignPathsMatchAuthServicesInternalControllerExactly() throws Exception {
        Method put = AuthInternalClient.class.getMethod(
            "replaceMenuCategories", UUID.class, UUID.class,
            BranchDtos.MenuCategoryAssignmentRequest.class);
        Method get = AuthInternalClient.class.getMethod(
            "listMenuCategories", UUID.class, UUID.class);

        // The literal, because a typo here is a 404 that only shows up in a running fleet — and
        // this session measured exactly that shape of failure on the live gateway.
        assertThat(put.getAnnotation(PutMapping.class).value())
            .containsExactly("/internal/auth/users/{userId}/menu-categories");
        assertThat(get.getAnnotation(GetMapping.class).value())
            .containsExactly("/internal/auth/users/{userId}/menu-categories");
    }
}
