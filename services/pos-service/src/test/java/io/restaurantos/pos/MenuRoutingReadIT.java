package io.restaurantos.pos;

import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.domain.model.StationType;
import io.restaurantos.pos.dto.CreateStationRequest;
import io.restaurantos.pos.dto.MenuRoutingDto;
import io.restaurantos.pos.dto.MenuRoutingDto.RouteSource;
import io.restaurantos.pos.dto.StationDto;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.MenuRoutingQueryService;
import io.restaurantos.pos.service.MenuService;
import io.restaurantos.pos.service.StationService;
import io.restaurantos.shared.exception.PermissionDeniedException;
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
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Routing must be READABLE, not merely writable (S1-01).
 *
 * <h2>The gap this closes</h2>
 *
 * <p>Both writes have worked since 28-05. Nothing could read a CATEGORY's route back, so the
 * screen that would call them could not be built: an admin could route "all Drinks to the bar" and
 * the product had no way to show that they had. {@link MenuStationRoutingIT} already proves the
 * WRITE side and the resolution order; every assertion here is about what a screen can SEE.
 *
 * <h2>Why {@code source} is asserted and not just the station</h2>
 *
 * <p>A screen that shows only the effective station cannot tell an admin whether a dish is on the
 * bar because somebody chose that for the dish, or because its category says so. Those two look
 * identical and behave completely differently the next time the category is re-routed — the first
 * does not move and the second does. Rendering them the same is how a routing screen quietly
 * teaches an owner the wrong model of their own configuration.
 */
class MenuRoutingReadIT extends PosTestBase {

    @Autowired MenuRoutingQueryService routingQuery;
    @Autowired MenuService menuService;
    @Autowired StationService stationService;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchA;
    UUID branchB;
    UUID userId;
    UUID drinksId;
    UUID colaId;
    UUID limeId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchA = UUID.randomUUID();
        branchB = UUID.randomUUID();
        userId = UUID.randomUUID();
        atBranch(branchA);

        MenuCategory drinks = new MenuCategory();
        drinks.setTenantId(tenantId);
        drinks.setName("Drinks-" + UUID.randomUUID());
        drinksId = menuCategoryRepository.save(drinks).getId();

        colaId = dish("Cola");
        limeId = dish("Fresh Lime");
    }

    // ── 1 — the read that did not exist ──────────────────────────────────────────────────────

    @Test
    void aCategoryRouteIsReadableBackAfterItIsWritten() {
        StationDto bar = station(branchA, "BAR", StationType.BAR);

        menuService.assignCategoryStation(drinksId, branchA, bar.id());

        MenuRoutingDto.CategoryRoute drinks = categoryRow(routingQuery.routingFor(branchA), drinksId);
        assertThat(drinks.stationId())
                .as("this is the whole gap: the write persisted and NOTHING could read it back, so "
                        + "no screen could show an admin what they had just configured")
                .isEqualTo(bar.id());
        assertThat(drinks.stationCode()).isEqualTo("BAR");
        assertThat(drinks.stationName()).isEqualTo("BAR Station");
    }

    @Test
    void anUnroutedCategoryReadsAsUnrouted_notAsMissing() {
        MenuRoutingDto.CategoryRoute drinks = categoryRow(routingQuery.routingFor(branchA), drinksId);
        assertThat(drinks.categoryName()).isNotBlank();
        assertThat(drinks.stationId())
                .as("'no route' is a value the screen renders, not a row the screen omits")
                .isNull();
    }

    // ── 2 — every item carries where it fires AND which rule put it there ────────────────────

    @Test
    void aCategoryRouteShowsOnEveryItemInItAsInherited() {
        StationDto bar = station(branchA, "BAR", StationType.BAR);
        menuService.assignCategoryStation(drinksId, branchA, bar.id());

        MenuRoutingDto routing = routingQuery.routingFor(branchA);

        for (UUID id : List.of(colaId, limeId)) {
            MenuRoutingDto.ItemRoute row = itemRow(routing, id);
            assertThat(row.effectiveStationCode()).isEqualTo("BAR");
            assertThat(row.stationId())
                    .as("the item has no route of its own — the screen must offer 'Follow category'")
                    .isNull();
            assertThat(row.source()).isEqualTo(RouteSource.CATEGORY);
        }
    }

    @Test
    void anItemOverrideBeatsTheCategoryAndSaysSo() {
        StationDto bar = station(branchA, "BAR", StationType.BAR);
        StationDto grill = station(branchA, "GRILL", StationType.KITCHEN);
        menuService.assignCategoryStation(drinksId, branchA, bar.id());

        menuService.assignStation(colaId, branchA, grill.id());

        MenuRoutingDto routing = routingQuery.routingFor(branchA);

        MenuRoutingDto.ItemRoute cola = itemRow(routing, colaId);
        assertThat(cola.effectiveStationCode()).isEqualTo("GRILL");
        assertThat(cola.stationId()).isEqualTo(grill.id());
        assertThat(cola.source())
                .as("ITEM, not CATEGORY — an exception and an inheritance must not read alike")
                .isEqualTo(RouteSource.ITEM);

        MenuRoutingDto.ItemRoute lime = itemRow(routing, limeId);
        assertThat(lime.effectiveStationCode())
                .as("the exception must not drag its siblings with it")
                .isEqualTo("BAR");
        assertThat(lime.source()).isEqualTo(RouteSource.CATEGORY);
    }

    @Test
    void anItemWithNoRouteAnywhereReadsAsNONE() {
        MenuRoutingDto.ItemRoute cola = itemRow(routingQuery.routingFor(branchA), colaId);
        assertThat(cola.effectiveStationId()).isNull();
        assertThat(cola.source())
                .as("NONE is what the DEFAULT board actually receives; the screen must say so "
                        + "rather than leaving a blank cell that reads as 'not loaded'")
                .isEqualTo(RouteSource.NONE);
    }

    // ── 3 — the branch boundary ──────────────────────────────────────────────────────────────

    @Test
    void routingIsPerBranch_andAnotherBranchsRouteIsNotVisibleHere() {
        StationDto barA = station(branchA, "BAR", StationType.BAR);
        menuService.assignCategoryStation(drinksId, branchA, barA.id());

        atBranch(branchB);
        MenuRoutingDto atB = routingQuery.routingFor(branchB);

        assertThat(categoryRow(atB, drinksId).stationId())
                .as("stations are branch-scoped; A's bar is not a destination B has")
                .isNull();
        assertThat(itemRow(atB, colaId).source()).isEqualTo(RouteSource.NONE);
    }

    @Test
    void readingAnotherBranchsRoutingIsRefused() {
        atBranch(branchA);
        assertThatThrownBy(() -> routingQuery.routingFor(branchB))
                .isInstanceOf(PermissionDeniedException.class);
    }

    @Test
    void aCallerWithoutMenuManageIsRefused() {
        tenantContext.set(tenantId, branchA, userId, null);
        JwtClaims cashier = new JwtClaims(userId, tenantId, branchA, List.of("CASHIER"),
                List.of("pos.menu.view"), Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(cashier, null, List.of()));

        assertThatThrownBy(() -> routingQuery.routingFor(branchA))
                .as("the read is gated exactly as tightly as the two writes it exists to serve")
                .isInstanceOf(PermissionDeniedException.class);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────

    private MenuRoutingDto.CategoryRoute categoryRow(MenuRoutingDto routing, UUID categoryId) {
        return routing.categories().stream()
                .filter(c -> c.categoryId().equals(categoryId))
                .findFirst()
                .orElseThrow(() -> new AssertionError("category " + categoryId + " absent from routing"));
    }

    private MenuRoutingDto.ItemRoute itemRow(MenuRoutingDto routing, UUID itemId) {
        return routing.items().stream()
                .filter(i -> i.itemId().equals(itemId))
                .findFirst()
                .orElseThrow(() -> new AssertionError("item " + itemId + " absent from routing"));
    }

    private UUID dish(String name) {
        MenuItem item = new MenuItem();
        item.setTenantId(tenantId);
        item.setCategory(menuCategoryRepository.findById(drinksId).orElseThrow());
        item.setName(name + "-" + UUID.randomUUID());
        item.setBasePricePaisa(25000L);
        item.setTaxRatePct(BigDecimal.ZERO);
        item.setActive(true);
        return menuItemRepository.save(item).getId();
    }

    private StationDto station(UUID branchId, String code, StationType type) {
        return stationService.createStation(branchId, new CreateStationRequest(code, code + " Station", type));
    }

    private void atBranch(UUID branchId) {
        tenantContext.set(tenantId, branchId, userId, null);
        JwtClaims claims = new JwtClaims(userId, tenantId, branchId, List.of("MANAGER"),
                List.of("pos.menu.manage", "pos.menu.view", "pos.order.create"), Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
    }
}
