package io.restaurantos.pos;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.dto.OrderSummaryDto;
import io.restaurantos.pos.dto.RefundRequest;
import io.restaurantos.pos.dto.VoidOrderRequest;
import io.restaurantos.pos.feign.AuthUserDirectoryClient;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.PaymentService;
import io.restaurantos.pos.service.RefundService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * S0-04 — a voided or refunded order must be reachable, and must say why and by whom.
 *
 * <p><b>The defect.</b> Order Management offered seven filter chips and a voided order appeared
 * under none of them: the default listing asks for non-terminal statuses excluding DRAFT, and the
 * only explicit terminal request the UI ever made was {@code [CLOSED]}. An owner therefore had no
 * screen anywhere on which a voided check existed. Even asking the API for it directly returned a
 * row with no reason and no actor — {@code void_reason} was never projected into the summary, and
 * the actor was never persisted at all (it lived only inside the ORDER_VOIDED event payload).
 *
 * <p><b>Why this test drives the HTTP ROUTE and not the service.</b> The settlement provenance is
 * attached by {@link io.restaurantos.pos.service.OrderSettlementDetailService} as a second pass
 * over the page, deliberately outside the hot row-building path. A test that called
 * {@code OrderService.listOrderSummaries} would assert on the un-enriched row and pass whether or
 * not the wiring exists — exactly the shape of green that this repair phase is cleaning up.
 */
class SettledOrderVisibilityIT extends PosTestBase {

    @Autowired WebApplicationContext webApplicationContext;
    @Autowired ObjectMapper objectMapper;
    @Autowired OrderService orderService;
    @Autowired PaymentService paymentService;
    @Autowired RefundService refundService;
    @Autowired OutboxRepository outboxRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired TenantContext tenantContext;

    @MockitoBean AuthUserDirectoryClient authUserDirectoryClient;

    MockMvc mockMvc;

    UUID tenantId;
    UUID branchId;
    UUID cashierId;
    UUID menuItemId;

    @BeforeEach
    void setUp() {
        // No security filter chain added on purpose: there is no JWT to mint here, and the gate
        // being asserted is method security, which reads the SecurityContextHolder this test
        // populates directly (see setSecurityContext). PrintJobClaimIT adds the real chain because
        // the filter IS its subject; here it would only be a second authentication to fake.
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext).build();
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
        item.setName("Nihari");
        item.setBasePricePaisa(45000L);
        item.setTaxRatePct(new BigDecimal("0.00"));
        menuItemId = menuItemRepository.save(item).getId();

        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new ApiResponse<>(
                        new FinancePeriodClient.PeriodStatusDto(UUID.randomUUID(), "OPEN", 2026, 6),
                        null, List.of()));
        when(opaClient.evaluate(any(), any())).thenReturn(new OpaDecision(true));
        when(authUserDirectoryClient.getUser(any(), any())).thenReturn(
                new AuthUserDirectoryClient.UserDetailEnvelope(
                        new AuthUserDirectoryClient.UserDetailBody(
                                new AuthUserDirectoryClient.UserSummaryBody(
                                        cashierId, "manager@terrace.local", "Terrace Manager"))));

        // OrderController is @RequiresFeature("FEATURE_POS") and the gate reads its answer from
        // the (mocked) Redis cache. Left unstubbed, opsForValue() returns null and every
        // assertion below dies inside the aspect without ever reaching the listing (same note as
        // MenuGridPagingIT). Feature gating has its own tests; here it is a precondition.
        ValueOperations<String, String> valueOps = mock(ValueOperations.class);
        when(stringRedisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.get(anyString())).thenReturn("true");

        setSecurityContext(List.of("pos.order.void.own", "pos.order.void.any",
                "pos.order.refund", "pos.order.view", "pos.order.view.all"));
        openTillForCashier(branchId);
    }

    /**
     * The permissions go in TWICE, and both are load-bearing: {@link JwtClaims} is what the
     * service layer's own checks read, and the {@code GrantedAuthority} list is what
     * {@code @PreAuthorize("hasAuthority('pos.order.view'))"} on the controller reads. A test
     * that only populated the claims would be denied at the controller — which is precisely the
     * gate this test exists to go through.
     */
    private void setSecurityContext(List<String> permissions) {
        JwtClaims claims = new JwtClaims(
                cashierId, tenantId, branchId,
                List.of("MANAGER"), permissions, Map.of("approval_limit_paisa", 30000000L), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null,
                        permissions.stream().map(SimpleGrantedAuthority::new).toList()));
    }

    private OrderDto openOrderWithOneItem() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        return orderService.getOrder(order.id(), branchId);
    }

    /**
     * The exact request Order Management issues — over MVC, not as a Java call.
     *
     * <p>Going through the route rather than through {@code orderController.listOrders(...)} is
     * deliberate twice over: it exercises the {@code @PreAuthorize} gate, the feature-flag aspect
     * and the JSON the browser actually parses, and it does not pin this test to that method's
     * PARAMETER LIST, which concurrent work on search is re-signing. A test that breaks because a
     * sibling change added a query parameter is a test that will be "fixed" by deleting it.
     */
    private List<OrderSummaryDto> list(List<String> statuses) throws Exception {
        MockHttpServletRequestBuilder request = get("/api/v1/pos/orders")
                .param("branchId", branchId.toString())
                .param("size", "50");
        if (statuses != null) {
            statuses.forEach(s -> request.param("status", s));
        }
        String json = mockMvc.perform(request)
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode data = objectMapper.readTree(json).get("data");
        List<OrderSummaryDto> rows = new ArrayList<>();
        for (JsonNode row : data) {
            rows.add(objectMapper.treeToValue(row, OrderSummaryDto.class));
        }
        return rows;
    }

    private OrderSummaryDto rowFor(List<OrderSummaryDto> rows, UUID orderId) {
        return rows.stream().filter(r -> r.orderId().equals(orderId)).findFirst().orElse(null);
    }

    @Test
    void voidedOrder_isListableByStatus_andCarriesReasonAndActor() throws Exception {
        OrderDto order = openOrderWithOneItem();
        orderService.voidOrder(order.id(),
                new VoidOrderRequest("Guest walked out before service"), UUID.randomUUID().toString());

        // The gap as filed: the default (chip "All"/"Active") listing is non-terminal only, which
        // is correct behaviour for an operational list — but it is ONLY defensible if an explicit
        // VOIDED request actually answers. This is the assertion that failed before the fix.
        assertThat(rowFor(list(null), order.id()))
                .as("the active listing is non-terminal by design")
                .isNull();

        OrderSummaryDto row = rowFor(list(List.of("VOIDED")), order.id());
        assertThat(row).as("a Voided filter must return the voided order").isNotNull();
        assertThat(row.settlementStatus()).isEqualTo(OrderStatus.VOIDED);
        assertThat(row.totalPaisa()).isEqualTo(45000L);

        assertThat(row.settlement())
                .as("a voided row with no reason and no actor is the defect, not the fix")
                .isNotNull();
        assertThat(row.settlement().reason()).isEqualTo("Guest walked out before service");
        assertThat(row.settlement().byUserId())
                .as("who voided it — persisted on the order (V21), not only inside the event")
                .isEqualTo(cashierId);
        assertThat(row.settlement().byName()).isEqualTo("Terrace Manager");
        assertThat(row.settlement().at()).isNotNull();
    }

    @Test
    void refundedOrder_isListableByStatus_andCarriesReasonAndActor() throws Exception {
        OrderDto closed = closeViaServeAndPay(orderService, paymentService, openOrderWithOneItem(), branchId);
        assertThat(closed.status()).isEqualTo(OrderStatus.CLOSED);

        refundService.refund(closed.id(),
                new RefundRequest(closed.totalPaisa(), "Dish sent back cold", "FULL"),
                UUID.randomUUID().toString());

        assertThat(rowFor(list(null), closed.id()))
                .as("the active listing is non-terminal by design")
                .isNull();

        OrderSummaryDto row = rowFor(list(List.of("REFUNDED")), closed.id());
        assertThat(row).as("a Refunded filter must return the refunded order").isNotNull();
        assertThat(row.settlementStatus()).isEqualTo(OrderStatus.REFUNDED);

        assertThat(row.settlement()).isNotNull();
        assertThat(row.settlement().reason()).isEqualTo("Dish sent back cold");
        assertThat(row.settlement().byUserId()).isEqualTo(cashierId);
        assertThat(row.settlement().byName()).isEqualTo("Terrace Manager");
    }

    /**
     * The name is decoration; the id is the fact. auth-service being unreachable must cost the
     * display name and nothing else — a directory hiccup that blanked a manager's order screen
     * would be a worse defect than the one being fixed.
     *
     * <p><b>The check is voided by somebody the directory has never been asked about, and that is
     * load-bearing.</b> {@code StaffNameDirectory} caches a resolved name for five minutes keyed
     * on tenant AND user, and since {@code 27225227} every till DTO names its owner —
     * {@code TillServiceImpl.toDto} calls {@code resolve} — so {@code setUp}'s
     * {@code openTillForCashier} puts {@code cashierId}'s name in that cache before any test body
     * runs. Declaring an outage against an already-cached name proves nothing: the row came back
     * carrying the cached "Terrace Manager", which is what this test failed on. Acting as a user
     * with no cache entry is what makes the outage reach the code under test — and a warm cache
     * is a name the outage genuinely does not cost, so there is nothing here to assert about it.
     */
    @Test
    void directoryOutage_costsTheNameAndNotTheRow() throws Exception {
        cashierId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, cashierId, null);
        setSecurityContext(List.of("pos.order.void.own", "pos.order.void.any",
                "pos.order.refund", "pos.order.view", "pos.order.view.all"));

        OrderDto order = openOrderWithOneItem();
        orderService.voidOrder(order.id(),
                new VoidOrderRequest("Till error"), UUID.randomUUID().toString());

        when(authUserDirectoryClient.getUser(any(), any()))
                .thenThrow(new IllegalStateException("auth-service unreachable"));

        OrderSummaryDto row = rowFor(list(List.of("VOIDED")), order.id());
        assertThat(row).isNotNull();
        assertThat(row.settlement().reason()).isEqualTo("Till error");
        assertThat(row.settlement().byUserId()).isEqualTo(cashierId);
        assertThat(row.settlement().byName()).isNull();
    }

    /** A live order costs nothing: no settlement block, and no lookup issued for it. */
    @Test
    void liveOrder_carriesNoSettlementBlock() throws Exception {
        OrderDto order = openOrderWithOneItem();
        OrderSummaryDto row = rowFor(list(null), order.id());
        assertThat(row).isNotNull();
        assertThat(row.settlement()).isNull();
    }
}
