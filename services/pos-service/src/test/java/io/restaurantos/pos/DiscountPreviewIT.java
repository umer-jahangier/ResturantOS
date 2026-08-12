package io.restaurantos.pos;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.pos.domain.enums.OrderType;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.dto.ServiceChargeDtos.UpdateServiceChargeRequest;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.ServiceChargeService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * D-1 — the previewed total IS the applied total, to the paisa.
 *
 * <h2>The defect this file exists to fail on</h2>
 *
 * <p>The discount panel answered "what will this do to the bill?" in the browser, by subtracting
 * the discount from {@code order.totalPaisa}. That figure is tax-INCLUSIVE, so the arithmetic
 * silently asserted that taking money off a check leaves the tax alone — the opposite of the ruling
 * in {@code .planning/decisions/D-TAX-DISCOUNT.md}, under which tax is priced on the line NET of
 * its share of every discount.
 *
 * <p>Measured live on 2026-08-12, order {@code ORD-20260812-0443}: subtotal Rs 1,700.00, tax
 * Rs 272.00, total Rs 1,972.00. A 10% whole-check discount previewed
 *
 * <pre>Takes Rs 170.00 off — new total Rs 1,802.00.</pre>
 *
 * <p>and applied as Rs 1,774.80, because the tax fell to Rs 244.80 and the preview never asked. The
 * guest was quoted Rs 27.20 more than the bill. That check settled at {@code amountPaisa 177480},
 * which is the figure {@link #thePreviewIsTheTotalTheGuestWillActuallyPay} pins.
 *
 * <h2>Falsification — how each test was watched to fail</h2>
 *
 * <ul>
 *   <li>{@link #thePreviewIsTheTotalTheGuestWillActuallyPay} — make {@code previewDiscount} return
 *       {@code previousTotal - staged.getAmountPaisa()} for its total, i.e. reproduce the browser's
 *       own rule on the server, and the test reports
 *       {@code expected 177480 but was 180200} — Rs 1,802.00, the exact wrong number a manager read
 *       aloud on the floor.</li>
 *   <li>{@link #aPreviewWritesNothing} — {@code previewDiscount} guards its staged mutation
 *       twice, with {@code readOnly = true} and with {@code entityManager.clear()}. Dropping
 *       EITHER one alone leaves this test green: each is independently sufficient. Dropping BOTH
 *       fails it —
 *       {@code [three previews, no discount on the check] expected: 0 but was: 1} — which is
 *       what proves the staged discount is a real pending write rather than a no-op. Recorded
 *       explicitly because a reader who removes one guard and sees green should know the suite is
 *       not endorsing that, only failing to notice it.</li>
 *   <li>{@link #thePreviewAgreesWithTheApplyOnACheckThatIsAlreadyDiscounted} — the second half of
 *       the defect. The panel re-derived the discount's own headroom and read
 *       {@code item.discountPaisa} as an input; that field is {@code recomputeOrderTotals}'s
 *       OUTPUT since V27, so the browser double-counted every line discount already on the check.
 *       On the floor that showed as Rs 213.90 previewed against Rs 208.90 applied. Any preview that
 *       computes its base by any means other than the server's own clamp fails this.</li>
 *   <li>{@link #thePreviewRefusesWhatTheApplyWouldRefuse} — fails against a preview that prices
 *       without running {@code assertDiscountable}, which is what a "pure arithmetic" preview
 *       helper would be.</li>
 * </ul>
 *
 * <p>Every assertion here compares two MEASURED figures — the preview's and the persisted check's,
 * the latter re-read over HTTP after commit. None of them asserts that a field is present. A test
 * asserting presence is what let this ship.
 */
class DiscountPreviewIT extends PosTestBase {

    /** Rs 1,700.00 and 16.00% — the live check the defect was measured on. */
    private static final long DISH_PAISA = 170_000L;
    private static final BigDecimal STANDARD_RATE = new BigDecimal("16.00");
    private static final BigDecimal SERVICE_CHARGE_RATE = new BigDecimal("5.00");

    @Autowired WebApplicationContext webApplicationContext;
    @Autowired ObjectMapper objectMapper;
    @Autowired OrderService orderService;
    @Autowired ServiceChargeService serviceChargeService;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired TenantContext tenantContext;

    MockMvc mockMvc;

    UUID tenantId;
    UUID branchId;
    UUID cashierId;
    UUID dishId;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext).build();

        // A fresh tenant per test — the tax base is tenant-scoped and a shared one would let
        // execution order decide the arithmetic.
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        cashierId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, cashierId, null);

        MenuCategory category = new MenuCategory();
        category.setTenantId(tenantId);
        category.setName("Mains-" + UUID.randomUUID());
        category.setSortOrder(1);
        category = menuCategoryRepository.save(category);

        MenuItem dish = new MenuItem();
        dish.setTenantId(tenantId);
        dish.setCategory(category);
        dish.setName("Mutton Karahi");
        dish.setBasePricePaisa(DISH_PAISA);
        dish.setTaxRatePct(STANDARD_RATE);
        dishId = menuItemRepository.save(dish).getId();

        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new ApiResponse<>(
                        new FinancePeriodClient.PeriodStatusDto(UUID.randomUUID(), "OPEN", 2026, 8),
                        null, List.of()));
        when(opaClient.evaluate(any(), any())).thenReturn(new OpaDecision(true));
        when(userBranchClient.getBranch(any(), any())).thenReturn(null);

        ValueOperations<String, String> valueOps = mock(ValueOperations.class);
        when(stringRedisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.get(anyString())).thenReturn("true");

        setSecurityContext();
        openTillForCashier(branchId);
    }

    private void setSecurityContext() {
        List<String> permissions = List.of(
                "pos.order.view", "pos.order.create", "pos.order.update", "pos.order.send_to_kds",
                "pos.order.discount.line", "pos.order.discount.order",
                "pos.menu.view", "pos.tax.manage", "pos.service_charge.manage");
        JwtClaims claims = new JwtClaims(
                cashierId, tenantId, branchId,
                List.of("OWNER"), permissions, Map.of("approval_limit_paisa", 30_000_000L), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null,
                        permissions.stream().map(SimpleGrantedAuthority::new).toList()));
    }

    // ── Driving the check over HTTP ──────────────────────────────────────────────────────────

    private OrderDto openCheck(OrderType type) {
        return orderService.createOrder(new CreateOrderRequest(
                branchId, UUID.randomUUID(), type, null, 2, null, null));
    }

    private UUID addDish(UUID orderId) throws Exception {
        String body = mockMvc.perform(post("/api/v1/pos/orders/{id}/items", orderId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new AddOrderItemRequest(dishId, branchId, 1, null, null))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode items = objectMapper.readTree(body).path("data").path("items");
        return UUID.fromString(items.get(items.size() - 1).path("id").asText());
    }

    private Map<String, Object> discountBody(String scope, UUID itemId, String type, String value) {
        return itemId == null
                ? Map.of("scope", scope, "type", type, "value", new BigDecimal(value),
                         "reason", "Kebab was cold")
                : Map.of("scope", scope, "orderItemId", itemId, "type", type,
                         "value", new BigDecimal(value), "reason", "Kebab was cold");
    }

    /** The preview, over the same HTTP route the panel calls. */
    private JsonNode preview(UUID orderId, Map<String, Object> body) throws Exception {
        String response = mockMvc.perform(post("/api/v1/pos/orders/{id}/discounts/preview", orderId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).path("data");
    }

    private void apply(UUID orderId, Map<String, Object> body) throws Exception {
        mockMvc.perform(post("/api/v1/pos/orders/{id}/discounts", orderId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk());
    }

    /**
     * The order as the browser reads it — the PERSISTED row, fetched back over HTTP rather than
     * taken from the return value of the call that wrote it.
     */
    private JsonNode readBack(UUID orderId) throws Exception {
        String body = mockMvc.perform(get("/api/v1/pos/orders/{id}", orderId)
                        .param("branchId", branchId.toString()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(body).path("data");
    }

    // ── The tests ────────────────────────────────────────────────────────────────────────────

    @Test
    void thePreviewIsTheTotalTheGuestWillActuallyPay() throws Exception {
        // Takeaway: no service charge, so these are exactly the live check's figures.
        OrderDto order = openCheck(OrderType.TAKEAWAY);
        addDish(order.id());

        JsonNode before = readBack(order.id());
        assertThat(before.path("subtotalPaisa").asLong()).isEqualTo(170_000L);
        assertThat(before.path("taxPaisa").asLong()).isEqualTo(27_200L);
        assertThat(before.path("totalPaisa").asLong())
                .as("the check as the manager found it: Rs 1,972.00")
                .isEqualTo(197_200L);

        Map<String, Object> tenPercentOffTheCheck = discountBody("ORDER", null, "PERCENT", "10");
        JsonNode quoted = preview(order.id(), tenPercentOffTheCheck);

        // What the browser used to say, named here so the regression is legible rather than
        // implied: Rs 1,972.00 − Rs 170.00 = Rs 1,802.00, which is not a total this system will
        // ever charge on this check.
        long theBrowsersAnswer = 197_200L - quoted.path("amountOffPaisa").asLong();
        assertThat(theBrowsersAnswer).isEqualTo(180_200L);
        assertThat(quoted.path("totalPaisa").asLong())
                .as("the preview must not be gross-minus-discount — that was the whole defect")
                .isNotEqualTo(theBrowsersAnswer);

        assertThat(quoted.path("amountOffPaisa").asLong()).isEqualTo(17_000L);
        assertThat(quoted.path("taxPaisa").asLong())
                .as("16%% of the Rs 1,530.00 that will actually be sold, not of the Rs 1,700.00 "
                        + "on the menu")
                .isEqualTo(24_480L);
        assertThat(quoted.path("totalPaisa").asLong())
                .as("Rs 1,774.80 — the figure ORD-20260812-0443 settled at (amountPaisa 177480)")
                .isEqualTo(177_480L);

        // Now do it, and read the committed row back. THIS is the reconciliation: the number the
        // manager was quoted and the number the guest is charged are the same number.
        apply(order.id(), tenPercentOffTheCheck);
        JsonNode charged = readBack(order.id());

        assertThat(charged.path("discountPaisa").asLong())
                .isEqualTo(quoted.path("amountOffPaisa").asLong());
        assertThat(charged.path("taxPaisa").asLong()).isEqualTo(quoted.path("taxPaisa").asLong());
        assertThat(charged.path("serviceChargePaisa").asLong())
                .isEqualTo(quoted.path("serviceChargePaisa").asLong());
        assertThat(charged.path("totalPaisa").asLong())
                .as("previewed total == charged total, to the paisa")
                .isEqualTo(quoted.path("totalPaisa").asLong());
    }

    @Test
    void thePreviewIncludesTheServiceChargeItWillMove() throws Exception {
        // 5% dine-in. The service charge's base is the net of every discount, so it moves too —
        // a preview that reported only the tax would still misquote a dine-in guest.
        serviceChargeService.update(branchId, new UpdateServiceChargeRequest(
                true, SERVICE_CHARGE_RATE, "Service charge", true, false, false));

        OrderDto order = openCheck(OrderType.DINE_IN);
        addDish(order.id());

        Map<String, Object> body = discountBody("ORDER", null, "PERCENT", "10");
        JsonNode quoted = preview(order.id(), body);

        assertThat(quoted.path("previousServiceChargePaisa").asLong())
                .as("5%% of Rs 1,700.00 before the discount")
                .isEqualTo(8_500L);
        assertThat(quoted.path("serviceChargePaisa").asLong())
                .as("5%% of the Rs 1,530.00 net — the charge falls with the discount")
                .isEqualTo(7_650L);

        apply(order.id(), body);
        JsonNode charged = readBack(order.id());

        assertThat(charged.path("serviceChargePaisa").asLong())
                .isEqualTo(quoted.path("serviceChargePaisa").asLong());
        assertThat(charged.path("totalPaisa").asLong())
                .isEqualTo(quoted.path("totalPaisa").asLong());
        // And the components the preview reported reconstruct the total it reported, so a screen
        // can show the breakdown without doing its own arithmetic on top.
        assertThat(quoted.path("totalPaisa").asLong())
                .isEqualTo(quoted.path("subtotalPaisa").asLong()
                        - quoted.path("discountPaisa").asLong()
                        + quoted.path("taxPaisa").asLong()
                        + quoted.path("serviceChargePaisa").asLong());
    }

    @Test
    void thePreviewAgreesWithTheApplyOnACheckThatIsAlreadyDiscounted() throws Exception {
        OrderDto order = openCheck(OrderType.TAKEAWAY);
        UUID line = addDish(order.id());

        // Rs 200.00 off the line first. The browser's own base then read this line's discount
        // TWICE — once from the discount row and once from item.discountPaisa, which V27 turned
        // into an output — so its percentage was taken of the wrong base.
        apply(order.id(), discountBody("LINE", line, "FLAT", "200.00"));

        Map<String, Object> tenPercentOffTheRest = discountBody("ORDER", null, "PERCENT", "10");
        JsonNode quoted = preview(order.id(), tenPercentOffTheRest);

        assertThat(quoted.path("amountOffPaisa").asLong())
                .as("10%% of the Rs 1,500.00 still on the check, not of a base that counts the "
                        + "Rs 200.00 line discount twice (which would give 13000)")
                .isEqualTo(15_000L);

        apply(order.id(), tenPercentOffTheRest);
        JsonNode charged = readBack(order.id());

        assertThat(charged.path("discountPaisa").asLong())
                .as("Rs 200.00 on the line plus the Rs 150.00 just previewed")
                .isEqualTo(20_000L + quoted.path("amountOffPaisa").asLong());
        assertThat(charged.path("totalPaisa").asLong())
                .isEqualTo(quoted.path("totalPaisa").asLong());
    }

    @Test
    void aPreviewWritesNothing() throws Exception {
        OrderDto order = openCheck(OrderType.TAKEAWAY);
        addDish(order.id());

        JsonNode before = readBack(order.id());

        preview(order.id(), discountBody("ORDER", null, "PERCENT", "10"));
        preview(order.id(), discountBody("ORDER", null, "PERCENT", "50"));
        preview(order.id(), discountBody("ORDER", null, "FLAT", "900.00"));

        JsonNode after = readBack(order.id());

        assertThat(after.path("discounts").size())
                .as("three previews, no discount on the check")
                .isZero();
        assertThat(after.path("discountPaisa").asLong()).isZero();
        assertThat(after.path("taxPaisa").asLong()).isEqualTo(before.path("taxPaisa").asLong());
        assertThat(after.path("totalPaisa").asLong())
                .as("the check the guest owes is untouched by having been asked a question")
                .isEqualTo(before.path("totalPaisa").asLong());
        // The lines too: stageDiscount stamps discount, tax and lineTotal onto every one of them.
        assertThat(after.path("items").get(0).path("discountPaisa").asLong()).isZero();
        assertThat(after.path("items").get(0).path("taxPaisa").asLong())
                .isEqualTo(before.path("items").get(0).path("taxPaisa").asLong());
    }

    @Test
    void thePreviewRefusesWhatTheApplyWouldRefuse() throws Exception {
        OrderDto order = openCheck(OrderType.TAKEAWAY);
        addDish(order.id());

        // A percentage over 100 is refused by the apply path with a named field. The preview runs
        // the same validation, so the panel learns it before the manager commits rather than after.
        mockMvc.perform(post("/api/v1/pos/orders/{id}/discounts/preview", order.id())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                discountBody("ORDER", null, "PERCENT", "500"))))
                .andExpect(status().is4xxClientError());

        // And a reason under three characters, which is the other rule stageDiscount enforces for
        // every caller rather than leaving to bean validation.
        mockMvc.perform(post("/api/v1/pos/orders/{id}/discounts/preview", order.id())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "scope", "ORDER", "type", "PERCENT",
                                "value", new BigDecimal("10"), "reason", "x"))))
                .andExpect(status().is4xxClientError());
    }
}
