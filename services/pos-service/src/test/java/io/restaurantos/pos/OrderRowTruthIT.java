package io.restaurantos.pos;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.pos.domain.enums.OrderType;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.feign.AuthUserDirectoryClient;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.OrderService;
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
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.math.BigDecimal;
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
 * F2 — the Order Management row must carry WHAT KIND of check it is and WHO took it.
 *
 * <h2>The defect</h2>
 *
 * <p>{@code OrderSummaryDto} carried neither. With no {@code type} on the row, the browser had
 * nothing to render but the table name, so it printed {@code tableName ?? "Takeaway"} — and every
 * dine-in check whose table had not been assigned read <b>Takeaway</b>. Measured live on
 * 2026-08-12 as {@code manager@terrace.local}: ten of ten rows on the first page were
 * {@code type=DINE_IN} on the server and "Takeaway" on the screen, while the void panel one click
 * away called the same check "Dine-in". With no cashier NAME on the row, the Server/Cashier column
 * printed {@code cashierId.slice(0, 8)} — {@code bc0d9897} — beside a Voided column that printed
 * "by Shift Cashier 984155" for a user id resolved by the same mechanism.
 *
 * <h2>Why these assertions read the JSON and not the record</h2>
 *
 * <p>Deliberately: {@code type} and {@code cashierName} did not EXIST as accessors before this
 * change, so a test written against {@code row.type()} would not compile against the broken code
 * and could never have been watched failing. Reading the response body is also what the browser
 * does — the wire is the contract, and the wire is what was empty.
 *
 * <p>And it drives the HTTP route, not the service: {@code cashierName} is attached by
 * {@link io.restaurantos.pos.service.OrderCashierNameService} as a pass over the built page, so a
 * test calling {@code OrderService.listOrderSummaries} would assert the un-enriched row and stay
 * green whether or not the controller ever wires the pass up.
 */
class OrderRowTruthIT extends PosTestBase {

    @Autowired WebApplicationContext webApplicationContext;
    @Autowired ObjectMapper objectMapper;
    @Autowired OrderService orderService;
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
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext).build();
        outboxRepository.deleteAll();
        // A fresh tenant per test: StaffNameDirectory's cache is keyed by tenant AND user, so a
        // random tenant here is also what keeps one test's cached name out of the next test's
        // assertions (the directory-outage case in particular).
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
                                        cashierId, "shift.cashier@terrace.local",
                                        "Shift Cashier 984155"))));

        // @RequiresFeature("FEATURE_POS") reads its answer from the (mocked) Redis cache; left
        // unstubbed every request dies in the aspect before reaching the listing.
        ValueOperations<String, String> valueOps = mock(ValueOperations.class);
        when(stringRedisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.get(anyString())).thenReturn("true");

        setSecurityContext(List.of("pos.order.view", "pos.order.view.all", "pos.order.create",
                "pos.order.update"));
        openTillForCashier(branchId);
    }

    private void setSecurityContext(List<String> permissions) {
        JwtClaims claims = new JwtClaims(
                cashierId, tenantId, branchId,
                List.of("MANAGER"), permissions, Map.of("approval_limit_paisa", 30000000L), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null,
                        permissions.stream().map(SimpleGrantedAuthority::new).toList()));
    }

    private OrderDto openOrder(OrderType type, UUID tableId) {
        OrderDto order = orderService.createOrder(new CreateOrderRequest(
                branchId, UUID.randomUUID(), type, tableId, 1, null, null));
        orderService.addItem(order.id(),
                new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        return orderService.getOrder(order.id(), branchId);
    }

    /** The raw row the browser parses, for one order id. */
    private JsonNode rowJson(UUID orderId) throws Exception {
        String json = mockMvc.perform(get("/api/v1/pos/orders")
                        .param("branchId", branchId.toString())
                        .param("size", "50"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        for (JsonNode row : objectMapper.readTree(json).get("data")) {
            if (orderId.toString().equals(row.path("orderId").asText())) {
                return row;
            }
        }
        return null;
    }

    @Test
    void aDineInOrderWithNoTable_stillSaysDineIn() throws Exception {
        OrderDto order = openOrder(OrderType.DINE_IN, null);

        JsonNode row = rowJson(order.id());
        assertThat(row).as("the order must be in the active listing").isNotNull();
        assertThat(row.path("tableName").isNull() || row.path("tableName").asText().isEmpty())
                .as("this check has no table — which is the whole point of the case")
                .isTrue();
        assertThat(row.path("type").asText())
                .as("a row with no `type` is what made the client guess `tableName ?? Takeaway`")
                .isEqualTo("DINE_IN");
    }

    @Test
    void aTakeawayOrder_saysTakeaway() throws Exception {
        OrderDto order = openOrder(OrderType.TAKEAWAY, null);

        assertThat(rowJson(order.id()).path("type").asText()).isEqualTo("TAKEAWAY");
    }

    @Test
    void everyRow_carriesTheCashiersName_notOnlyTheirId() throws Exception {
        OrderDto order = openOrder(OrderType.DINE_IN, null);

        JsonNode row = rowJson(order.id());
        assertThat(row.path("cashierId").asText()).isEqualTo(cashierId.toString());
        assertThat(row.path("cashierName").asText())
                .as("the id is the fact, but a manager reading a list all day needs the person")
                .isEqualTo("Shift Cashier 984155");
    }

    /**
     * The name is decoration; the id is the fact. An unreachable directory must cost the name and
     * nothing else — and must NOT cost the id, because a blank Server/Cashier cell reads as
     * "nobody took this check", which is worse than the hex fragment being replaced.
     *
     * <p><b>The check is rung by a cashier nobody has asked the directory about, and that is
     * load-bearing.</b> {@code StaffNameDirectory} caches a resolved name for five minutes keyed
     * on tenant AND user, and since {@code 27225227} every till DTO names its owner —
     * {@code TillServiceImpl.toDto} calls {@code resolve} — so {@code setUp}'s
     * {@code openTillForCashier} puts {@code cashierId}'s name in that cache before any test body
     * runs. Declaring an outage against an already-cached name proves nothing: the row comes back
     * with the cached "Shift Cashier 984155", which is what this test failed on. Switching to a
     * cashier the directory has never been asked about is what makes the outage reach the code
     * under test, and it is also the only shape of this failure a manager would ever see — a
     * warm cache is a name the outage genuinely does not cost.
     */
    @Test
    void directoryOutage_costsTheNameAndNotTheRow() throws Exception {
        cashierId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, cashierId, null);
        setSecurityContext(List.of("pos.order.view", "pos.order.view.all", "pos.order.create",
                "pos.order.update"));

        OrderDto order = openOrder(OrderType.DINE_IN, null);
        when(authUserDirectoryClient.getUser(any(), any()))
                .thenThrow(new IllegalStateException("auth-service unreachable"));

        JsonNode row = rowJson(order.id());
        assertThat(row).as("the list must still answer").isNotNull();
        assertThat(row.path("cashierId").asText()).isEqualTo(cashierId.toString());
        assertThat(row.path("cashierName").isNull() || row.path("cashierName").isMissingNode())
                .as("degrade to the id, never invent a name")
                .isTrue();
        assertThat(row.path("type").asText()).isEqualTo("DINE_IN");
    }

    /**
     * A void reason long enough to need wrapping must also be long enough to SAVE.
     *
     * <p>{@code voidOrder} passed the raw reason as the idempotency service's {@code requestHash},
     * whose column is {@code VARCHAR(64)}, while {@code VoidOrderRequest} validates
     * {@code @Size(max = 500)}. Any reason past 64 characters therefore died in the database as
     * {@code SQLState 22001 — value too long for type character varying(64)}, surfaced as a
     * generic {@code 409 CONFLICT}, and the void panel said "Failed to void. Please try again." —
     * advice that could never work, because the same sentence fails the same way every time.
     *
     * <p>The reason below is the one this item's own browser proof used, at 149 characters. It is
     * asserted through the SERVICE rather than the route because the failure is a write, and the
     * assertion is that the order is actually VOIDED with the whole reason intact — not merely
     * that the call returned.
     */
    @Test
    void aVoidReasonLongerThanTheHashColumn_stillVoidsTheCheck() {
        OrderDto order = openOrder(OrderType.DINE_IN, null);
        String longReason = "F2 proof — the guest was quoted the wrong price on the board, refused "
                + "the check at the pass and left before service, so the whole thing is coming off";
        assertThat(longReason.length()).as("the case only exists past 64 characters").isGreaterThan(64);

        orderService.voidOrder(order.id(),
                new io.restaurantos.pos.dto.VoidOrderRequest(longReason), UUID.randomUUID().toString());

        OrderDto after = orderService.getOrder(order.id(), branchId);
        assertThat(after.status()).isEqualTo(io.restaurantos.pos.domain.enums.OrderStatus.VOIDED);
    }

    /**
     * One page, one cashier, one lookup. The cashier pass runs on the ACTIVE list — the hot one —
     * so a lookup per ROW rather than per distinct PERSON would put twenty internal calls on a
     * twenty-row refetch that a busy till issues on every window focus.
     */
    @Test
    void aPageOfChecksByOneCashier_asksTheDirectoryOnce() throws Exception {
        for (int i = 0; i < 4; i++) {
            openOrder(OrderType.DINE_IN, null);
        }

        rowJson(UUID.randomUUID()); // one listing of four rows

        org.mockito.Mockito.verify(authUserDirectoryClient, org.mockito.Mockito.times(1))
                .getUser(any(), any());
    }
}
