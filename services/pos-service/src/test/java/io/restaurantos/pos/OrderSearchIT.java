package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.model.DiningTable;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.dto.OrderSummaryDto;
import io.restaurantos.pos.dto.VoidOrderRequest;
import io.restaurantos.pos.feign.CrmCustomerSearchClient;
import io.restaurantos.pos.repository.DiningTableRepository;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.PaymentService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * S0-05 — Order Management search must be answered by the SERVER, across every status.
 *
 * <p>The defect these tests pin down: the search box was a {@code source.filter(...)} over the
 * rows the page had already fetched, matching only {@code orderNo} and {@code tableName}. So it
 * could only ever find an order that was (a) on the current page and (b) inside the currently
 * selected status chip. Typing the number of a check you had just voided returned
 * "No active orders" — the row was never in the array being filtered — and a customer's phone
 * matched nothing at all, because the summary row does not carry one.
 *
 * <p>Each test below is written so it fails if {@code q} is accepted and then ignored — the
 * "structurally present, behaviourally absent" shape this codebase keeps producing. A search
 * that merely narrows the DEFAULT (non-terminal, non-DRAFT) scope passes none of them.
 */
class OrderSearchIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired PaymentService paymentService;
    @Autowired OutboxRepository outboxRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired DiningTableRepository tableRepository;
    @Autowired TenantContext tenantContext;

    /**
     * crm-service owns phones; pos-service asks it which customers a term matches. Mocked
     * rather than dialled so this test proves the JOIN of the two answers, which is the part
     * that was missing — CRM's own matching is CrmCustomerSearchIT's subject.
     */
    @MockitoBean CrmCustomerSearchClient crmCustomerSearchClient;

    private static final Pageable FIRST_PAGE = PageRequest.of(0, 20);

    UUID tenantId;
    UUID branchId;
    UUID cashierId;
    UUID burgerId;

    @BeforeEach
    void setUp() {
        outboxRepository.deleteAll();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        cashierId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, cashierId, null);

        MenuCategory cat = new MenuCategory();
        cat.setTenantId(tenantId);
        cat.setName("Mains-" + UUID.randomUUID());
        cat.setSortOrder(1);
        cat = menuCategoryRepository.save(cat);

        MenuItem item = new MenuItem();
        item.setTenantId(tenantId);
        item.setCategory(cat);
        item.setName("Burger");
        item.setBasePricePaisa(55000L);
        item.setTaxRatePct(new BigDecimal("0.00"));
        burgerId = menuItemRepository.save(item).getId();

        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new ApiResponse<>(
                        new io.restaurantos.pos.feign.FinancePeriodClient.PeriodStatusDto(
                                UUID.randomUUID(), "OPEN", 2026, 6),
                        null, List.of()));
        when(crmCustomerSearchClient.searchCustomerIds(any(), anyInt(), any())).thenReturn(List.of());

        openTillForCashier(branchId);
    }

    @AfterEach
    void clearSecurityContext() {
        // SecurityContextHolder is a ThreadLocal and the surefire fork reuses the thread —
        // leaving claims behind would silently hand pos.order.view.all to the next test.
        SecurityContextHolder.clearContext();
    }

    private void setSecurityContext(UUID userId, List<String> permissions) {
        JwtClaims claims = new JwtClaims(
                userId, tenantId, branchId, List.of("CASHIER"), permissions, Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
    }

    private OrderDto firedOrder() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(burgerId, branchId, 1, null, null));
        return orderService.getOrder(order.id(), branchId);
    }

    private static List<UUID> idsOf(Page<OrderSummaryDto> page) {
        return page.getContent().stream().map(OrderSummaryDto::orderId).toList();
    }

    /** The register's exact complaint: searching a voided check's number returns nothing. */
    @Test
    void search_findsVoidedOrder_withNoStatusFilterSelected() {
        OrderDto order = firedOrder();
        // voidOrder is OPA-gated (VoidOwnOrderIT owns that path); grant + allow here purely to
        // reach the VOIDED state this test is about.
        setSecurityContext(cashierId, List.of("pos.order.void.own"));
        when(opaClient.evaluate(eq("pos"), any())).thenReturn(new OpaDecision(true));
        orderService.voidOrder(order.id(), new VoidOrderRequest("Guest left"), UUID.randomUUID().toString());

        // Precondition — the UNSEARCHED default list genuinely hides it. Without this the test
        // could pass on a search that does nothing at all.
        assertThat(idsOf(orderService.listOrderSummaries(branchId, null, null, FIRST_PAGE)))
                .doesNotContain(order.id());

        // The last four digits, which is what a manager actually types.
        String tail = order.orderNo().substring(order.orderNo().length() - 4);
        Page<OrderSummaryDto> hit = orderService.listOrderSummaries(branchId, null, tail, FIRST_PAGE);

        assertThat(idsOf(hit)).contains(order.id());
        assertThat(hit.getContent().stream()
                .filter(r -> r.orderId().equals(order.id()))
                .findFirst().orElseThrow()
                .settlementStatus())
                .isEqualTo(OrderStatus.VOIDED);
    }

    /** Same, for a CLOSED check — findable without first switching to the Closed chip. */
    @Test
    void search_findsClosedOrder_withNoStatusFilterSelected() {
        OrderDto order = firedOrder();
        OrderDto closed = closeViaServeAndPay(orderService, paymentService, order, branchId);
        assertThat(closed.status()).isEqualTo(OrderStatus.CLOSED);

        assertThat(idsOf(orderService.listOrderSummaries(branchId, null, null, FIRST_PAGE)))
                .doesNotContain(order.id());

        String tail = order.orderNo().substring(order.orderNo().length() - 4);
        assertThat(idsOf(orderService.listOrderSummaries(branchId, null, tail, FIRST_PAGE)))
                .contains(order.id());
    }

    /**
     * The phone leg. The summary row carries no phone at all, so this can only pass by
     * resolving the term against crm-service and filtering on {@code customerId}.
     */
    @Test
    void search_findsOrderByCustomerPhone() {
        UUID customerId = UUID.randomUUID();
        OrderDto withCustomer = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, customerId, null));
        orderService.addItem(withCustomer.id(), new AddOrderItemRequest(burgerId, branchId, 1, null, null));
        OrderDto other = firedOrder();

        when(crmCustomerSearchClient.searchCustomerIds(eq("03009824573"), anyInt(), eq(tenantId)))
                .thenReturn(List.of(customerId));

        List<UUID> found = idsOf(
                orderService.listOrderSummaries(branchId, null, "03009824573", FIRST_PAGE));

        assertThat(found).contains(withCustomer.id());
        assertThat(found).doesNotContain(other.id());
    }

    /** Table name, which lives in dining_tables and never on the order row. */
    @Test
    void search_findsOrderByTableName() {
        DiningTable table = new DiningTable();
        table.setTenantId(tenantId);
        table.setBranchId(branchId);
        table.setTableNumber("Terrace-9");
        table.setCapacity(4);
        table = tableRepository.save(table);

        OrderDto seated = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, table.getId(), 1, null, null));
        orderService.addItem(seated.id(), new AddOrderItemRequest(burgerId, branchId, 1, null, null));
        OrderDto takeaway = firedOrder();

        List<UUID> found = idsOf(orderService.listOrderSummaries(branchId, null, "terrace-9", FIRST_PAGE));

        assertThat(found).contains(seated.id());
        assertThat(found).doesNotContain(takeaway.id());
    }

    /**
     * Search must reach past the page the browser happens to be holding. 25 orders, a 20-row
     * page: the 25th is invisible to any client-side filter over what was fetched.
     */
    @Test
    void search_reachesAnOrderBeyondTheFirstPage() {
        OrderDto target = firedOrder();
        for (int i = 0; i < 24; i++) {
            firedOrder();
        }

        assertThat(idsOf(orderService.listOrderSummaries(branchId, null, null, FIRST_PAGE)))
                .doesNotContain(target.id());

        String tail = target.orderNo().substring(target.orderNo().length() - 4);
        assertThat(idsOf(orderService.listOrderSummaries(branchId, null, tail, FIRST_PAGE)))
                .contains(target.id());
    }

    /**
     * A non-matching term must return nothing rather than everything — the failure mode where
     * an unmatched predicate is quietly dropped and search degrades into "show me the list".
     */
    @Test
    void search_withNoMatch_returnsEmpty() {
        firedOrder();
        assertThat(orderService.listOrderSummaries(branchId, null, "ZZ-NOTHING-ZZ", FIRST_PAGE))
                .isEmpty();
    }

    /**
     * SECURITY regression guard: widening search across every status must not also widen it
     * across cashiers. A caller without {@code pos.order.view.all} still sees only their own
     * checks — search is not a side door around POS-09's own-vs-all-branch rule.
     *
     * <p>{@code pos.order.view.all} is read straight off the JWT claims by
     * {@code PosAuthorizationService.hasPermission}, so a context WITHOUT it is how "an ordinary
     * cashier" is expressed here.
     */
    @Test
    void search_doesNotRevealAnotherCashiersOrder_withoutViewAllPermission() {
        OrderDto mine = firedOrder();
        OrderDto theirs = orderOfAColleague();

        setSecurityContext(cashierId, List.of("pos.order.view"));

        String theirTail = theirs.orderNo().substring(theirs.orderNo().length() - 4);
        assertThat(idsOf(orderService.listOrderSummaries(branchId, null, theirTail, FIRST_PAGE)))
                .doesNotContain(theirs.id());

        String myTail = mine.orderNo().substring(mine.orderNo().length() - 4);
        assertThat(idsOf(orderService.listOrderSummaries(branchId, null, myTail, FIRST_PAGE)))
                .contains(mine.id());
    }

    /** The other side of the same rule: a manager WITH the permission does find it. */
    @Test
    void search_revealsAnotherCashiersOrder_withViewAllPermission() {
        OrderDto theirs = orderOfAColleague();

        setSecurityContext(cashierId, List.of("pos.order.view", "pos.order.view.all"));

        String theirTail = theirs.orderNo().substring(theirs.orderNo().length() - 4);
        assertThat(idsOf(orderService.listOrderSummaries(branchId, null, theirTail, FIRST_PAGE)))
                .contains(theirs.id());
    }

    /** An order created by a different cashier in the same branch. Restores the context after. */
    private OrderDto orderOfAColleague() {
        UUID colleague = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, colleague, null);
        openTillForCashier(branchId);
        OrderDto theirs = firedOrder();
        tenantContext.set(tenantId, branchId, cashierId, null);
        return theirs;
    }

    /**
     * The unsearched 3-arg overload must open its own transaction.
     *
     * <p>Adding `q` was first done by making the old signature an interface {@code default} that
     * delegates. That compiles, reads well, and breaks every caller: a default method carries no
     * {@code @Transactional}, and its call to the annotated sibling is a self-invocation the proxy
     * never sees — so the rows are built with no Hibernate session and {@code order.getItems()}
     * throws {@code LazyInitializationException}. This asserts the overload still works, which is
     * the only observable difference between the two shapes.
     */
    @Test
    void unsearchedOverload_stillBuildsRows_insideATransaction() {
        OrderDto order = firedOrder();
        Page<OrderSummaryDto> page = orderService.listOrderSummaries(branchId, null, FIRST_PAGE);
        OrderSummaryDto listRow = page.getContent().stream()
                .filter(r -> r.orderId().equals(order.id()))
                .findFirst().orElseThrow();
        // itemQuantity is read off the lazily-loaded items collection — the exact thing that
        // needs a live session.
        assertThat(listRow.itemQuantity()).isEqualTo(1);
    }

    /**
     * A CRM outage degrades the customer leg, never the whole search. The manager looking for
     * an order NUMBER still finds it.
     */
    @Test
    void search_stillMatchesOrderNumber_whenCrmIsUnreachable() {
        OrderDto order = firedOrder();
        when(crmCustomerSearchClient.searchCustomerIds(any(), anyInt(), any()))
                .thenThrow(new IllegalStateException("crm-service down"));

        String tail = order.orderNo().substring(order.orderNo().length() - 4);
        assertThat(idsOf(orderService.listOrderSummaries(branchId, null, tail, FIRST_PAGE)))
                .contains(order.id());
    }
}
