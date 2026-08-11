package io.restaurantos.pos;

import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.KitchenTicketAssembler;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.print.PrintDocument;
import io.restaurantos.shared.print.ReceiptAmount;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.lang.reflect.RecordComponent;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * The eight behaviours a chef's ticket has to have, and the one it must not.
 */
class KitchenTicketAssemblerIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired KitchenTicketAssembler assembler;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;
    UUID cashierId;
    UUID hotItemId;
    UUID coldItemId;
    UUID unstationedItemId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        cashierId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, cashierId, null);

        MenuCategory cat = new MenuCategory();
        cat.setTenantId(tenantId);
        cat.setName("Mains-" + UUID.randomUUID());
        cat.setSortOrder(1);
        cat = menuCategoryRepository.save(cat);

        hotItemId = menuItem(cat, "Chicken Karahi", "HOT");
        coldItemId = menuItem(cat, "Garden Salad", "COLD");
        unstationedItemId = menuItem(cat, "Mineral Water", null);

        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new ApiResponse<>(
                        new FinancePeriodClient.PeriodStatusDto(UUID.randomUUID(), "OPEN", 2026, 8),
                        null, List.of()));
    }

    private UUID menuItem(MenuCategory cat, String name, String station) {
        MenuItem item = new MenuItem();
        item.setTenantId(tenantId);
        item.setCategory(cat);
        item.setName(name);
        item.setBasePricePaisa(50_000L);
        item.setTaxRatePct(new BigDecimal("16.00"));
        item.setKdsStation(station);
        return menuItemRepository.save(item).getId();
    }

    // ══ 1. Two stations, two tickets, each carrying only its own lines ════════════════════════

    @Test
    @DisplayName("an order spanning two stations produces two tickets, neither carrying the other's items")
    void twoStations_produceTwoTickets_eachWithOnlyItsOwnItems() {
        OrderDto order = orderWith(hotItemId, coldItemId);
        OrderDto fired = orderService.sendToKds(order.id(), null);

        List<KitchenTicketAssembler.StationTicket> tickets =
                assembler.assemble(order.id(), branchId, 1, idsOf(fired));

        assertThat(tickets).hasSize(2);
        assertThat(tickets.stream().map(KitchenTicketAssembler.StationTicket::stationCode))
                .containsExactlyInAnyOrder("HOT", "COLD");

        PrintDocument hot = ticketFor(tickets, "HOT").document();
        assertThat(names(hot)).containsExactly("Chicken Karahi");
        assertThat(names(ticketFor(tickets, "COLD").document())).containsExactly("Garden Salad");
    }

    // ══ 2. A revision fires only its NEW lines ════════════════════════════════════════════════

    @Test
    @DisplayName("a revision fire carries only the newly-fired lines; the first fire's lines appear on none of them")
    void revisionFire_carriesOnlyTheNewLines() {
        OrderDto order = orderWith(hotItemId);
        OrderDto first = orderService.sendToKds(order.id(), null);
        Set<UUID> firstIds = idsOf(first);

        orderService.addItem(order.id(), new AddOrderItemRequest(coldItemId, branchId, 1, null, null));
        OrderDto second = orderService.sendToKds(order.id(), null);

        // Exactly the ids that carry the SECOND revision — the set sendToKds just stamped.
        Set<UUID> newlyFired = second.items().stream()
                .filter(i -> i.revisionNo() == 2)
                .map(OrderDto.OrderItemDto::id)
                .collect(Collectors.toSet());
        assertThat(newlyFired).hasSize(1).doesNotContainAnyElementsOf(firstIds);

        List<KitchenTicketAssembler.StationTicket> tickets =
                assembler.assemble(order.id(), branchId, 2, newlyFired);

        assertThat(tickets).hasSize(1);
        assertThat(tickets.get(0).stationCode()).isEqualTo("COLD");
        assertThat(names(tickets.get(0).document()))
                .as("the starter must not be cooked twice")
                .containsExactly("Garden Salad")
                .doesNotContain("Chicken Karahi");
        assertThat(tickets.get(0).document().ticket().revisionNo()).isEqualTo(2);
    }

    // ══ 3. What a chef needs to route a plate back to a table ═════════════════════════════════

    @Test
    @DisplayName("every ticket carries the order number, the type, the covers, the revision, the fired time and the server")
    void everyTicketCarriesWhatAChefNeeds() {
        OrderDto order = orderWith(hotItemId);
        OrderDto fired = orderService.sendToKds(order.id(), null);

        PrintDocument doc = assembler.assemble(order.id(), branchId, 1, idsOf(fired)).get(0).document();

        assertThat(doc.orderNo()).isEqualTo(fired.orderNo()).isNotBlank();
        PrintDocument.Ticket t = doc.ticket();
        assertThat(t).isNotNull();
        assertThat(t.stationCode()).isEqualTo("HOT");
        assertThat(t.orderTypeLabel()).isEqualTo(fired.type().name());
        assertThat(t.coverCount()).isEqualTo(3);
        assertThat(t.revisionNo()).isEqualTo(1);
        assertThat(t.firedAt()).isNotNull();
        assertThat(t.serverRef())
                .as("a name lookup is deferred (D-7); the reference is what a shift roster matches")
                .isEqualTo(cashierId);
    }

    // ══ 4. Notes: per-item on their own station, order-level on every station ═════════════════

    @Test
    @DisplayName("a per-item note rides its own station's ticket; an order-level instruction rides every one")
    void perItemNotesStayOnTheirStation_andOrderInstructionsReachAll() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 3, null,
                        "No nuts on this table"));
        orderService.addItem(order.id(),
                new AddOrderItemRequest(hotItemId, branchId, 1, null, "extra spicy"));
        orderService.addItem(order.id(), new AddOrderItemRequest(coldItemId, branchId, 1, null, null));
        OrderDto fired = orderService.sendToKds(order.id(), null);

        List<KitchenTicketAssembler.StationTicket> tickets =
                assembler.assemble(order.id(), branchId, 1, idsOf(fired));

        PrintDocument hot = ticketFor(tickets, "HOT").document();
        PrintDocument cold = ticketFor(tickets, "COLD").document();

        assertThat(hot.lines().get(0).note()).isEqualTo("extra spicy");
        assertThat(cold.lines().get(0).note())
                .as("one station's item note must not leak onto another station's paper")
                .isNull();

        for (PrintDocument doc : List.of(hot, cold)) {
            assertThat(doc.ticket().orderInstructions())
                    .as("an allergy line applies to the whole order, so every pass must see it")
                    .containsExactly("No nuts on this table");
        }
    }

    // ══ 5. Modifiers travel with their line ═══════════════════════════════════════════════════

    @Test
    @DisplayName("modifiers travel on the line they belong to")
    void modifiersTravelWithTheirLine() {
        UUID modifierId = UUID.randomUUID();
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 3, null, null));
        orderService.addItem(order.id(),
                new AddOrderItemRequest(hotItemId, branchId, 1, List.of(modifierId), null));
        OrderDto fired = orderService.sendToKds(order.id(), null);

        PrintDocument doc = assembler.assemble(order.id(), branchId, 1, idsOf(fired)).get(0).document();
        assertThat(doc.lines().get(0).modifiers()).hasSize(1);
    }

    // ══ 6. NO MONEY, scanned generically ══════════════════════════════════════════════════════

    /**
     * The load-bearing test in this file.
     *
     * <p>It walks the produced record by REFLECTION rather than checking a list of field names, so
     * a money field added to {@link PrintDocument} in a later phase cannot leak an amount past it.
     * The schema's compact constructor already refuses totals, tenders, the tax breakdown, the
     * fiscal region and the drawer; what it cannot refuse is a populated {@code Line.lineTotal},
     * because the line declares it non-optional. This is the assertion that covers that gap.
     */
    @Test
    @DisplayName("a ticket carries no populated money component anywhere in the document")
    void noMoneyAnywhereOnTheTicket() {
        OrderDto order = orderWith(hotItemId, coldItemId);
        OrderDto fired = orderService.sendToKds(order.id(), null);

        List<KitchenTicketAssembler.StationTicket> tickets =
                assembler.assemble(order.id(), branchId, 1, idsOf(fired));

        for (KitchenTicketAssembler.StationTicket ticket : tickets) {
            List<ReceiptAmount> amounts = allAmounts(ticket.document());
            assertThat(amounts)
                    .as("the scan must actually reach the line amounts, or it proves nothing")
                    .isNotEmpty();
            assertThat(amounts.stream().filter(a -> a.paisa() != 0L).toList())
                    .as("the kitchen does not see what the customer paid")
                    .isEmpty();
        }
    }

    @Test
    @DisplayName("the document schema itself refuses a kitchen ticket carrying totals — the guard is reached, not assumed")
    void theSchemaGuardIsReachable() {
        OrderDto order = orderWith(hotItemId);
        OrderDto fired = orderService.sendToKds(order.id(), null);
        PrintDocument clean = assembler.assemble(order.id(), branchId, 1, idsOf(fired)).get(0).document();

        assertThatThrownBy(() -> new PrintDocument(
                clean.schemaVersion(), clean.type(), clean.provenance(), clean.tenantId(),
                clean.branchId(), clean.orderId(), clean.orderNo(), clean.issue(), clean.header(),
                clean.ticket(), clean.lines(),
                new PrintDocument.Totals(ReceiptAmount.of(1), ReceiptAmount.zero(),
                        ReceiptAmount.zero(), ReceiptAmount.zero(), ReceiptAmount.of(1)),
                clean.taxBreakdown(), clean.tenders(), clean.fiscal(), clean.drawer(), clean.cut(),
                clean.footer()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("KITCHEN_TICKET");
    }

    // ══ 7. An unstationed item is a visible ticket, not a dropped line ════════════════════════

    @Test
    @DisplayName("an item with no station lands on an explicit UNASSIGNED ticket rather than vanishing")
    void unstationedItems_landOnAnExplicitUnassignedTicket() {
        OrderDto order = orderWith(unstationedItemId);
        OrderDto fired = orderService.sendToKds(order.id(), null);

        List<KitchenTicketAssembler.StationTicket> tickets =
                assembler.assemble(order.id(), branchId, 1, idsOf(fired));

        assertThat(tickets).hasSize(1);
        // sendToKds coalesces a null station to "DEFAULT" only in the KDS payload; the persisted
        // line keeps its null, which is what the assembler sees.
        assertThat(tickets.get(0).stationCode())
                .isIn(KitchenTicketAssembler.UNASSIGNED_STATION, "DEFAULT");
        assertThat(names(tickets.get(0).document()))
                .as("a dish with no station is a configuration defect and must be visible on paper")
                .containsExactly("Mineral Water");
    }

    // ══ 8. An explicit count, even for one ════════════════════════════════════════════════════

    @Test
    @DisplayName("a quantity of one is carried as an explicit count, not inferred")
    void quantityOfOneIsExplicit() {
        OrderDto order = orderWith(hotItemId);
        OrderDto fired = orderService.sendToKds(order.id(), null);

        PrintDocument doc = assembler.assemble(order.id(), branchId, 1, idsOf(fired)).get(0).document();
        assertThat(doc.lines().get(0).quantity()).isEqualTo(1);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────

    private OrderDto orderWith(UUID... menuItemIds) {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 3, null, null));
        for (UUID id : menuItemIds) {
            orderService.addItem(order.id(), new AddOrderItemRequest(id, branchId, 1, null, null));
        }
        return orderService.getOrder(order.id(), branchId);
    }

    private static Set<UUID> idsOf(OrderDto order) {
        return order.items().stream().map(OrderDto.OrderItemDto::id).collect(Collectors.toSet());
    }

    private static List<String> names(PrintDocument doc) {
        return doc.lines().stream().map(PrintDocument.Line::name).toList();
    }

    private static KitchenTicketAssembler.StationTicket ticketFor(
            List<KitchenTicketAssembler.StationTicket> tickets, String station) {
        return tickets.stream().filter(t -> station.equals(t.stationCode())).findFirst()
                .orElseThrow(() -> new AssertionError("no ticket for station " + station));
    }

    /**
     * Every {@link ReceiptAmount} anywhere in the object graph, found by walking record components.
     * Deliberately generic: naming the fields would only cover the ones somebody remembered.
     */
    private static List<ReceiptAmount> allAmounts(Object root) {
        List<ReceiptAmount> found = new ArrayList<>();
        collectAmounts(root, found, java.util.Collections.newSetFromMap(new IdentityHashMap<>()));
        return found;
    }

    private static void collectAmounts(Object node, List<ReceiptAmount> found, Set<Object> seen) {
        if (node == null || !seen.add(node)) {
            return;
        }
        if (node instanceof ReceiptAmount amount) {
            found.add(amount);
            return;
        }
        if (node instanceof Iterable<?> iterable) {
            iterable.forEach(child -> collectAmounts(child, found, seen));
            return;
        }
        Class<?> type = node.getClass();
        if (!type.isRecord()) {
            return;
        }
        for (RecordComponent component : type.getRecordComponents()) {
            try {
                collectAmounts(component.getAccessor().invoke(node), found, seen);
            } catch (ReflectiveOperationException e) {
                throw new AssertionError("could not read " + component.getName(), e);
            }
        }
    }
}
