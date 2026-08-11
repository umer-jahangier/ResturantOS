package io.restaurantos.pos;

import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuCategoryStationRoute;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.domain.model.MenuItemStationRoute;
import io.restaurantos.pos.domain.model.Station;
import io.restaurantos.pos.repository.MenuCategoryStationRouteRepository;
import io.restaurantos.pos.repository.MenuItemStationRouteRepository;
import io.restaurantos.pos.repository.StationRepository;
import io.restaurantos.pos.service.StationRoutingResolver;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Where a dish goes, decided in one place and testable without an order (28-05).
 *
 * <h2>The two cases that are the point</h2>
 *
 * <p>{@link #twoBranchesRouteTheSameItemIndependently_andNeitherDisturbsTheOther()} and
 * {@link #aLegacyStationIdBelongingToAnotherBranch_doesNotAnswerForThisOne()}. Together they are
 * the shipped bug: {@code menu_items} has no branch, so one row's {@code station_id} answered for
 * every branch, and an admin at Branch B assigning a dish to B's grill re-pointed the same dish for
 * Branch A. Each write passed its own branch guard; nothing guarded the collision.
 *
 * <p>A unit test, deliberately. A routing rule that can only be exercised through {@code addItem}
 * is a routing rule whose edge cases get asserted through six layers of setup — which is how they
 * stop being asserted.
 */
class StationRoutingResolverTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID BRANCH_A = UUID.randomUUID();
    private static final UUID BRANCH_B = UUID.randomUUID();

    private MenuItemStationRouteRepository itemRoutes;
    private MenuCategoryStationRouteRepository categoryRoutes;
    private StationRepository stations;
    private StationRoutingResolver resolver;

    @BeforeEach
    void setUp() {
        itemRoutes = mock(MenuItemStationRouteRepository.class);
        categoryRoutes = mock(MenuCategoryStationRouteRepository.class);
        stations = mock(StationRepository.class);
        // Unstubbed lookups answer "not found" rather than null, so a test that forgets to stub a
        // step fails as "nothing resolved" rather than with a NullPointerException that hides
        // which step was reached.
        when(itemRoutes.findByTenantIdAndBranchIdAndMenuItemId(any(), any(), any()))
                .thenReturn(Optional.empty());
        when(categoryRoutes.findByTenantIdAndBranchIdAndCategoryId(any(), any(), any()))
                .thenReturn(Optional.empty());
        when(stations.findByIdAndTenantIdAndBranchId(any(), any(), any())).thenReturn(Optional.empty());
        when(stations.findByTenantIdAndBranchIdAndCode(any(), any(), any())).thenReturn(Optional.empty());
        resolver = new StationRoutingResolver(itemRoutes, categoryRoutes, stations);
    }

    // ── 1 ────────────────────────────────────────────────────────────────────────────────────

    @Test
    void anItemWithABranchRoute_resolvesToThatRoutesStation() {
        MenuItem item = item(null, null);
        Station grill = station(BRANCH_A, "GRILL");
        givenItemRoute(BRANCH_A, item.getId(), grill);

        assertThat(resolver.resolve(TENANT, BRANCH_A, item)).contains(grill);
    }

    // ── 2 — the bug, direction one ───────────────────────────────────────────────────────────

    @Test
    void twoBranchesRouteTheSameItemIndependently_andNeitherDisturbsTheOther() {
        MenuItem sharedDish = item(null, null);
        Station grillAtA = station(BRANCH_A, "GRILL");
        Station tandoorAtB = station(BRANCH_B, "TANDOOR");
        givenItemRoute(BRANCH_A, sharedDish.getId(), grillAtA);
        givenItemRoute(BRANCH_B, sharedDish.getId(), tandoorAtB);

        // Asserted in BOTH directions. Asserting only that B changed proves nothing about whether
        // A moved, and A moving is the bug.
        assertThat(resolver.resolve(TENANT, BRANCH_A, sharedDish)).contains(grillAtA);
        assertThat(resolver.resolve(TENANT, BRANCH_B, sharedDish)).contains(tandoorAtB);
    }

    // ── 3 ────────────────────────────────────────────────────────────────────────────────────

    @Test
    void anItemWithNoItemRoute_fallsToItsCategorysRouteForThisBranch() {
        MenuCategory drinks = category();
        MenuItem mojito = item(drinks, null, null);
        Station bar = station(BRANCH_A, "BAR");
        givenCategoryRoute(BRANCH_A, drinks.getId(), bar);

        assertThat(resolver.resolve(TENANT, BRANCH_A, mojito))
                .as("'all drinks go to the bar' is one row, not two hundred")
                .contains(bar);
    }

    // ── 4 ────────────────────────────────────────────────────────────────────────────────────

    @Test
    void anItemLevelRouteWinsOverTheCategoryRouteForTheSameBranch() {
        MenuCategory drinks = category();
        MenuItem alcoholFreeMojito = item(drinks, null, null);
        Station bar = station(BRANCH_A, "BAR");
        Station pantry = station(BRANCH_A, "PANTRY");
        givenCategoryRoute(BRANCH_A, drinks.getId(), bar);
        givenItemRoute(BRANCH_A, alcoholFreeMojito.getId(), pantry);

        assertThat(resolver.resolve(TENANT, BRANCH_A, alcoholFreeMojito))
                .as("the per-item route is how the exception to a category rule is expressed")
                .contains(pantry);
    }

    // ── 5 ────────────────────────────────────────────────────────────────────────────────────

    @Test
    void aLegacyStationIdPointingIntoThisBranch_stillResolves() {
        Station grill = station(BRANCH_A, "GRILL");
        MenuItem item = item(grill.getId(), null);
        when(stations.findByIdAndTenantIdAndBranchId(grill.getId(), TENANT, BRANCH_A))
                .thenReturn(Optional.of(grill));

        assertThat(resolver.resolve(TENANT, BRANCH_A, item))
                .as("a tenant who has configured nothing must get byte-identical behaviour")
                .contains(grill);
    }

    // ── 6 — the bug, direction two ───────────────────────────────────────────────────────────

    @Test
    void aLegacyStationIdBelongingToAnotherBranch_doesNotAnswerForThisOne() {
        Station grillAtB = station(BRANCH_B, "GRILL");
        MenuItem sharedDish = item(grillAtB.getId(), null);
        // The station exists, but not in branch A. The branch-scoped finder therefore misses.
        when(stations.findByIdAndTenantIdAndBranchId(grillAtB.getId(), TENANT, BRANCH_B))
                .thenReturn(Optional.of(grillAtB));

        assertThat(resolver.resolve(TENANT, BRANCH_A, sharedDish))
                .as("the failure mode changes from 'wrong kitchen' to 'unconfigured' — only one "
                        + "of those is recoverable by looking at a screen")
                .isEmpty();
    }

    // ── 7 ────────────────────────────────────────────────────────────────────────────────────

    @Test
    void aLegacyFreeTextKeyMatchingACodeInThisBranch_resolves() {
        Station grill = station(BRANCH_A, "GRILL");
        MenuItem item = item(null, "GRILL");
        when(stations.findByTenantIdAndBranchIdAndCode(TENANT, BRANCH_A, "GRILL"))
                .thenReturn(Optional.of(grill));

        assertThat(resolver.resolve(TENANT, BRANCH_A, item)).contains(grill);
    }

    // ── 8 ────────────────────────────────────────────────────────────────────────────────────

    @Test
    void anItemWithNoneOfTheAbove_resolvesToNothing_whichTheCallerRendersAsDefault() {
        assertThat(resolver.resolve(TENANT, BRANCH_A, item(null, null))).isEmpty();
    }

    // ── 9 ────────────────────────────────────────────────────────────────────────────────────

    @Test
    void aRouteRowNamingAStationOutsideTheBranch_isIgnoredRatherThanFollowed() {
        // Defence in depth against a row that should not exist. The write path validates the
        // station's branch, so this row can only arrive by direct SQL or a future bug — and when
        // it does, following it would fire tickets into another building.
        MenuItem item = item(null, null);
        MenuItemStationRoute rogue = new MenuItemStationRoute();
        rogue.setBranchId(BRANCH_A);
        rogue.setMenuItemId(item.getId());
        rogue.setStationId(station(BRANCH_B, "TANDOOR").getId());
        when(itemRoutes.findByTenantIdAndBranchIdAndMenuItemId(TENANT, BRANCH_A, item.getId()))
                .thenReturn(Optional.of(rogue));
        // The station does not resolve inside branch A, so the route is not followed.

        assertThat(resolver.resolve(TENANT, BRANCH_A, item)).isEmpty();
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────

    private void givenItemRoute(UUID branchId, UUID itemId, Station station) {
        MenuItemStationRoute route = new MenuItemStationRoute();
        route.setBranchId(branchId);
        route.setMenuItemId(itemId);
        route.setStationId(station.getId());
        when(itemRoutes.findByTenantIdAndBranchIdAndMenuItemId(TENANT, branchId, itemId))
                .thenReturn(Optional.of(route));
        when(stations.findByIdAndTenantIdAndBranchId(station.getId(), TENANT, branchId))
                .thenReturn(Optional.of(station));
    }

    private void givenCategoryRoute(UUID branchId, UUID categoryId, Station station) {
        MenuCategoryStationRoute route = new MenuCategoryStationRoute();
        route.setBranchId(branchId);
        route.setCategoryId(categoryId);
        route.setStationId(station.getId());
        when(categoryRoutes.findByTenantIdAndBranchIdAndCategoryId(TENANT, branchId, categoryId))
                .thenReturn(Optional.of(route));
        when(stations.findByIdAndTenantIdAndBranchId(station.getId(), TENANT, branchId))
                .thenReturn(Optional.of(station));
    }

    private static MenuCategory category() {
        MenuCategory c = new MenuCategory();
        c.setId(UUID.randomUUID());
        c.setTenantId(TENANT);
        c.setName("Drinks");
        return c;
    }

    private static MenuItem item(UUID legacyStationId, String legacyCode) {
        return item(category(), legacyStationId, legacyCode);
    }

    private static MenuItem item(MenuCategory category, UUID legacyStationId, String legacyCode) {
        MenuItem i = new MenuItem();
        i.setId(UUID.randomUUID());
        i.setTenantId(TENANT);
        i.setCategory(category);
        i.setStationId(legacyStationId);
        i.setKdsStation(legacyCode);
        return i;
    }

    private static Station station(UUID branchId, String code) {
        Station s = new Station();
        s.setId(UUID.randomUUID());
        s.setTenantId(TENANT);
        s.setBranchId(branchId);
        s.setCode(code);
        s.setName(code);
        s.setActive(true);
        return s;
    }
}
