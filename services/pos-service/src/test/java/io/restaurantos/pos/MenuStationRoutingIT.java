package io.restaurantos.pos;

import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.domain.model.StationType;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.CreateStationRequest;
import io.restaurantos.pos.dto.MenuItemDto;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.dto.StationDto;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.repository.OrderRepository;
import org.springframework.jdbc.core.JdbcTemplate;
import io.restaurantos.pos.service.MenuService;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.StationService;
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

/**
 * Two branches can send the same dish to two different stations, and neither can overwrite the
 * other (28-05).
 *
 * <h2>The bug this closes, and why it was invisible</h2>
 *
 * <p>{@code menu_items} has no branch — it hangs off a tenant-unique category — so a two-branch
 * tenant has ONE row for "Chicken Karahi" and ONE {@code station_id} on it. An admin at Branch B
 * assigning it to B's grill silently re-pointed the same dish for Branch A and overwrote the
 * free-text mirror with B's code, after which A's tickets routed to a code that may not exist there.
 * Each write passed its own branch guard; nothing guarded the collision, because the row was not
 * branch-scoped at all. It has been invisible only because no UI calls the endpoint — and plan 28-10
 * is about to build that UI.
 *
 * <p>{@link #assigningAtBranchB_leavesBranchAsRoutingExactlyWhereItWas()} asserts it in BOTH
 * directions. Asserting only that B changed proves nothing about whether A moved, and A moving is
 * the bug.
 */
class MenuStationRoutingIT extends PosTestBase {

    @Autowired MenuService menuService;
    @Autowired OrderService orderService;
    @Autowired StationService stationService;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired OrderRepository orderRepository;
    /**
     * The snapshot assertions read order_items with raw SQL rather than through the entity graph.
     * Two reasons: Order.items is lazy and there is no open session outside the service call, and
     * more usefully, what these tests are ABOUT is which values landed in the two snapshot columns
     * — so reading the columns is the more direct statement of the claim.
     */
    @Autowired JdbcTemplate jdbcTemplate;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchA;
    UUID branchB;
    UUID userId;
    UUID categoryId;
    UUID dishId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchA = UUID.randomUUID();
        branchB = UUID.randomUUID();
        userId = UUID.randomUUID();
        atBranch(branchA);

        MenuCategory category = new MenuCategory();
        category.setTenantId(tenantId);
        category.setName("Mains-" + UUID.randomUUID());
        categoryId = menuCategoryRepository.save(category).getId();

        MenuItem dish = new MenuItem();
        dish.setTenantId(tenantId);
        dish.setCategory(menuCategoryRepository.findById(categoryId).orElseThrow());
        dish.setName("Chicken Karahi");
        dish.setBasePricePaisa(120000L);
        dish.setTaxRatePct(BigDecimal.ZERO);
        dish.setActive(true);
        dishId = menuItemRepository.save(dish).getId();
    }

    // ── 1 ────────────────────────────────────────────────────────────────────────────────────

    @Test
    void assigningAStationCreatesARouteForTheCallersBranch() {
        StationDto grillA = station(branchA, "GRILL", StationType.KITCHEN);

        MenuItemDto assigned = menuService.assignStation(dishId, branchA, grillA.id());

        assertThat(assigned.effectiveStationId()).isEqualTo(grillA.id());
        assertThat(assigned.effectiveStationCode()).isEqualTo("GRILL");
    }

    // ── 2 — the bug, asserted in both directions ─────────────────────────────────────────────

    @Test
    void assigningAtBranchB_leavesBranchAsRoutingExactlyWhereItWas() {
        StationDto grillA = station(branchA, "GRILL", StationType.KITCHEN);
        menuService.assignStation(dishId, branchA, grillA.id());

        atBranch(branchB);
        StationDto tandoorB = station(branchB, "TANDOOR", StationType.KITCHEN);
        menuService.assignStation(dishId, branchB, tandoorB.id());

        assertThat(menuService.getItem(dishId, branchB).effectiveStationId())
                .isEqualTo(tandoorB.id());

        atBranch(branchA);
        assertThat(menuService.getItem(dishId, branchA).effectiveStationId())
                .as("A must be exactly where A left it. Before this plan, B's assignment moved it.")
                .isEqualTo(grillA.id());
        assertThat(menuService.getItem(dishId, branchA).effectiveStationCode()).isEqualTo("GRILL");
    }

    // ── 3 ────────────────────────────────────────────────────────────────────────────────────

    @Test
    void clearingAnAssignmentFallsThroughToTheCategoryRoute() {
        StationDto grillA = station(branchA, "GRILL", StationType.KITCHEN);
        StationDto passA = station(branchA, "PASS", StationType.EXPO);
        menuService.assignCategoryStation(categoryId, branchA, passA.id());
        menuService.assignStation(dishId, branchA, grillA.id());
        assertThat(menuService.getItem(dishId, branchA).effectiveStationId()).isEqualTo(grillA.id());

        menuService.assignStation(dishId, branchA, null);

        assertThat(menuService.getItem(dishId, branchA).effectiveStationId())
                .as("clearing the exception leaves the category rule standing")
                .isEqualTo(passA.id());
    }

    // ── 4 ────────────────────────────────────────────────────────────────────────────────────

    @Test
    void aCategoryRouteRoutesEveryItemInItThatHasNoItemLevelRoute() {
        StationDto barA = station(branchA, "BAR", StationType.BAR);
        MenuItem secondDish = new MenuItem();
        secondDish.setTenantId(tenantId);
        secondDish.setCategory(menuCategoryRepository.findById(categoryId).orElseThrow());
        secondDish.setName("Mutton Karahi");
        secondDish.setBasePricePaisa(150000L);
        secondDish.setTaxRatePct(BigDecimal.ZERO);
        secondDish.setActive(true);
        UUID secondId = menuItemRepository.save(secondDish).getId();

        menuService.assignCategoryStation(categoryId, branchA, barA.id());

        assertThat(menuService.getItem(dishId, branchA).effectiveStationId()).isEqualTo(barA.id());
        assertThat(menuService.getItem(secondId, branchA).effectiveStationId())
                .as("'everything in this category goes there' is one row, not two hundred")
                .isEqualTo(barA.id());
    }

    // ── 5 ────────────────────────────────────────────────────────────────────────────────────

    @Test
    void addingAnItemSnapshotsTheStationResolvedForTheOrdersBranch() {
        StationDto grillA = station(branchA, "GRILL", StationType.KITCHEN);
        menuService.assignStation(dishId, branchA, grillA.id());

        OrderDto order = newOrderWithDish();

        assertThat(snapshotStationIds(order.id())).containsExactly(grillA.id());
        assertThat(snapshotCodes(order.id())).containsExactly("GRILL");
    }

    // ── 6 — the snapshot invariant ───────────────────────────────────────────────────────────

    @Test
    void aRouteChangedAfterALineWasAdded_doesNotReRouteThatLine() {
        StationDto grillA = station(branchA, "GRILL", StationType.KITCHEN);
        menuService.assignStation(dishId, branchA, grillA.id());
        OrderDto order = newOrderWithDish();

        StationDto tandoorA = station(branchA, "TANDOOR", StationType.KITCHEN);
        menuService.assignStation(dishId, branchA, tandoorA.id());

        assertThat(snapshotStationIds(order.id()))
                .as("BOTH routing keys are captured at add-item time and never at fire time. This "
                        + "test fails if resolution ever moves to sendToKds — a dish already on "
                        + "the grill must not jump to the tandoor because a manager edited a menu.")
                .containsExactly(grillA.id());
        assertThat(snapshotCodes(order.id())).containsExactly("GRILL");
    }

    // ── 7 ────────────────────────────────────────────────────────────────────────────────────

    @Test
    void aRouteChangedAfterALineWasAdded_doesApplyToTheNextLineAddedToTheSameOrder() {
        StationDto grillA = station(branchA, "GRILL", StationType.KITCHEN);
        menuService.assignStation(dishId, branchA, grillA.id());
        OrderDto order = newOrderWithDish();

        StationDto tandoorA = station(branchA, "TANDOOR", StationType.KITCHEN);
        menuService.assignStation(dishId, branchA, tandoorA.id());
        orderService.addItem(order.id(), new AddOrderItemRequest(dishId, branchA, 1, null, null));

        assertThat(snapshotCodes(order.id()))
                .as("the snapshot is per LINE, not per order — a line added after the change "
                        + "carries the new destination")
                .containsExactlyInAnyOrder("GRILL", "TANDOOR");
    }

    // ── 8 ────────────────────────────────────────────────────────────────────────────────────

    @Test
    void anItemWithNoRouteAnywhere_behavesExactlyAsItAlwaysHas() {
        // The whole back-compat story: a tenant who configures nothing must be unaffected.
        OrderDto order = newOrderWithDish();

        assertThat(snapshotStationIds(order.id())).containsExactly((UUID) null);
        assertThat(snapshotCodes(order.id()))
                .as("null free-text is what sendToKds already coalesces to DEFAULT")
                .containsExactly((String) null);
        assertThat(menuService.getItem(dishId, branchA).effectiveStationId()).isNull();
    }

    // ── 9 ────────────────────────────────────────────────────────────────────────────────────

    @Test
    void aMenuItemResponseCarriesTheEffectiveStationForTheRequestedBranch() {
        StationDto barA = station(branchA, "BAR", StationType.BAR);
        menuService.assignStation(dishId, branchA, barA.id());

        MenuItemDto atA = menuService.getItem(dishId, branchA);
        assertThat(atA.effectiveStationId()).isEqualTo(barA.id());
        assertThat(atA.effectiveStationCode()).isEqualTo("BAR");
        assertThat(atA.effectiveStationName()).isEqualTo("BAR Station");

        atBranch(branchB);
        assertThat(menuService.getItem(dishId, branchB).effectiveStationId())
                .as("the same dish, asked about at a branch with no route, answers null — the "
                        + "picker in 28-10 renders that as 'not routed here'")
                .isNull();
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────

    private List<UUID> snapshotStationIds(UUID orderId) {
        return jdbcTemplate.query(
                "SELECT station_id FROM order_items WHERE order_id = ? ORDER BY created_at",
                (rs, i) -> rs.getObject(1, UUID.class), orderId);
    }

    private List<String> snapshotCodes(UUID orderId) {
        return jdbcTemplate.query(
                "SELECT kds_station FROM order_items WHERE order_id = ? ORDER BY created_at",
                (rs, i) -> rs.getString(1), orderId);
    }

    private OrderDto newOrderWithDish() {
        OrderDto order = orderService.createOrder(new CreateOrderRequest(
                branchA, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(dishId, branchA, 1, null, null));
        return order;
    }

    private StationDto station(UUID branchId, String code, StationType type) {
        return stationService.createStation(branchId, new CreateStationRequest(code, code + " Station", type));
    }

    private void atBranch(UUID branchId) {
        tenantContext.set(tenantId, branchId, userId, null);
        // `pos.order.create` — singular. This read `pos.orders.create` for its whole life: a
        // plural typo of a real code, which is in no catalogue and on no role.
        JwtClaims claims = new JwtClaims(userId, tenantId, branchId, List.of("MANAGER"),
                List.of("pos.menu.manage", "pos.menu.view", "pos.order.create"), Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
    }
}
