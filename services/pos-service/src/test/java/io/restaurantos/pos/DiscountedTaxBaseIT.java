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
import io.restaurantos.pos.feign.UserBranchClient;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.PaymentService;
import io.restaurantos.pos.service.ReceiptDocumentAssembler;
import io.restaurantos.pos.service.ServiceChargeService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.event.OutboxEntry;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.print.PrintDocument;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * V27 — a discount moves the tax and the service charge together, or it moves neither.
 *
 * <h2>The defect this file exists to fail on</h2>
 *
 * <p>{@code OrderServiceImpl.recomputeOrderTotals} priced two charges on one bill by opposite
 * rules: tax was the sum of per-line snapshots taken on the GROSS line (V23) and the service
 * charge was recomputed on the NET of every discount (V24). Measured live on 2026-08-12 at
 * Floating Terrace F-7, order ORD-20260812-0356 as {@code cashier@terrace.local}: a Rs 49.90 line
 * discount moved the service charge and left the tax at Rs 12.80 where the discounted base gives
 * Rs 12.01 — Rs 0.79 over-charged on one discount. Comping the check further, the charge page read
 *
 * <pre>Subtotal Rs 809.00 | Discounts Rs 579.00 | Taxes Rs 12.80 | Total Rs 254.30</pre>
 *
 * <p>i.e. output tax collected, and remitted, on Rs 809.00 of food when Rs 230.00 was sold.
 *
 * <h2>Falsification — how each test was watched to fail</h2>
 *
 * <ul>
 *   <li>{@link #aLineDiscountMovesTheTaxAsWellAsTheServiceCharge} — the whole defect in one
 *       assertion. Restore {@code tax += item.getTaxPaisa()} in {@code recomputeOrderTotals} and
 *       the tax comes back Rs 170.00 on a check discounted to Rs 900.00, exactly as it did in
 *       production, while the service charge moves.</li>
 *   <li>{@link #aTenantThatHoldsTheOppositePositionKeepsTheOldArithmetic} fails against any
 *       implementation that hard-codes the net base and ignores {@code tenant_tax_policy} — the
 *       setting has to actually reach the pricing path, not merely exist.</li>
 *   <li>{@link #theLinesAndTheOrderAgree_soTheBillWillPrint} fails against an implementation that
 *       re-bases the ORDER's tax without pushing the same figures down onto its lines:
 *       {@code ReceiptDocumentAssembler} throws rather than printing when
 *       {@code Σ lineTax != order.taxPaisa}, so that shape leaves a cashier holding a guest's
 *       money and no way to produce paper.</li>
 *   <li>{@link #anOrderLevelDiscountIsSplitAcrossTwoRatesInProportion} fails against a waterfall
 *       allocation, which would put the whole discount on whichever line sorted first and make the
 *       tax relief depend on the order the cashier rang the dishes in.</li>
 *   <li>{@link #anIndivisibleDiscountStillSumsToItself} fails against per-line rounding: three ways
 *       of splitting Rs 10.00 three ways, each rounded independently, lose a paisa and the
 *       receipt's subtotal identity refuses the bill.</li>
 *   <li>{@link #theClosedCheckStillBalancesTheJournal} fails against any change that puts tax on
 *       one side of {@code AutoPostingRecipeEngine}'s revenue entry and not the other.</li>
 * </ul>
 */
class DiscountedTaxBaseIT extends PosTestBase {

    /** Rs 1,000.00, so every figure below divides cleanly and can be checked by eye. */
    private static final long DISH_PAISA = 100_000L;
    private static final BigDecimal STANDARD_RATE = new BigDecimal("17.00");
    private static final BigDecimal SERVICE_CHARGE_RATE = new BigDecimal("5.00");

    @Autowired WebApplicationContext webApplicationContext;
    @Autowired ObjectMapper objectMapper;
    @Autowired OrderService orderService;
    @Autowired PaymentService paymentService;
    @Autowired ServiceChargeService serviceChargeService;
    @Autowired ReceiptDocumentAssembler receiptAssembler;
    @Autowired OutboxRepository outboxRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired TenantContext tenantContext;

    // userBranchClient is @MockitoBean on PosTestBase (ActiveBranchGuard made it universal).

    MockMvc mockMvc;

    UUID tenantId;
    UUID branchId;
    UUID cashierId;
    UUID standardRatedItemId;
    UUID zeroRatedItemId;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext).build();
        outboxRepository.deleteAll();

        // A fresh tenant per test: the tax policy this suite writes is TENANT-scoped, so sharing
        // one would let the GROSS test leak into the NET tests depending on execution order.
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        cashierId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, cashierId, null);

        MenuCategory category = new MenuCategory();
        category.setTenantId(tenantId);
        category.setName("Mains-" + UUID.randomUUID());
        category.setSortOrder(1);
        category = menuCategoryRepository.save(category);

        standardRatedItemId = saveDish(category, "Nihari", STANDARD_RATE);
        // A genuinely zero-rated dish, NOT a pre-F16 line: it carries a rate of 0 AND no tax, which
        // is the combination OrderItem.taxRatePct documents as ordinary. It is here so the
        // allocation is tested across DIFFERENT buckets, which is the only case where the choice
        // between pro-rata and a waterfall is visible in the money.
        zeroRatedItemId = saveDish(category, "Bottled water", BigDecimal.ZERO);

        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new ApiResponse<>(
                        new FinancePeriodClient.PeriodStatusDto(UUID.randomUUID(), "OPEN", 2026, 8),
                        null, List.of()));
        when(opaClient.evaluate(any(), any())).thenReturn(new OpaDecision(true));
        // Fail-soft by design (D-26-01): the assembler degrades the document and still produces a
        // bill. Returning null exercises that path and keeps this suite off user-service.
        when(userBranchClient.getBranch(any(), any())).thenReturn(null);

        // @RequiresFeature("FEATURE_POS") reads its answer from the (mocked) Redis cache; left
        // unstubbed every request dies in the aspect before reaching the controller.
        ValueOperations<String, String> valueOps = mock(ValueOperations.class);
        when(stringRedisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.get(anyString())).thenReturn("true");

        setSecurityContext();
        openTillForCashier(branchId);

        // 5% dine-in, so that every assertion below has BOTH charges on it. A test that exercised
        // the tax alone could not show the two agreeing, which is the actual claim.
        serviceChargeService.update(branchId, new UpdateServiceChargeRequest(
                true, SERVICE_CHARGE_RATE, "Service charge", true, false, false));
    }

    private UUID saveDish(MenuCategory category, String name, BigDecimal ratePct) {
        MenuItem item = new MenuItem();
        item.setTenantId(tenantId);
        item.setCategory(category);
        item.setName(name);
        item.setBasePricePaisa(DISH_PAISA);
        item.setTaxRatePct(ratePct);
        return menuItemRepository.save(item).getId();
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

    // ── Driving and reading the check over HTTP ──────────────────────────────────────────────

    private OrderDto openCheck() {
        return orderService.createOrder(new CreateOrderRequest(
                branchId, UUID.randomUUID(), OrderType.DINE_IN, null, 2, null, null));
    }

    private UUID addDish(UUID orderId, UUID menuItemId) throws Exception {
        String body = mockMvc.perform(post("/api/v1/pos/orders/{id}/items", orderId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new AddOrderItemRequest(menuItemId, branchId, 1, null, null))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode items = objectMapper.readTree(body).path("data").path("items");
        return UUID.fromString(items.get(items.size() - 1).path("id").asText());
    }

    private void applyDiscount(UUID orderId, String scope, UUID itemId, String type,
                               String value, String reason) throws Exception {
        mockMvc.perform(post("/api/v1/pos/orders/{id}/discounts", orderId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "scope", scope,
                                "orderItemId", itemId,
                                "type", type,
                                "value", new BigDecimal(value),
                                "reason", reason))))
                .andExpect(status().isOk());
    }

    private void applyOrderDiscount(UUID orderId, String value, String reason) throws Exception {
        mockMvc.perform(post("/api/v1/pos/orders/{id}/discounts", orderId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "scope", "ORDER",
                                "type", "FLAT",
                                "value", new BigDecimal(value),
                                "reason", reason))))
                .andExpect(status().isOk());
    }

    /**
     * The order as the browser reads it — the PERSISTED row, fetched back over the HTTP route
     * rather than taken from the return value of the call that wrote it. A response body built in
     * the same transaction can agree with a row that was never committed.
     */
    private JsonNode readBack(UUID orderId) throws Exception {
        String body = mockMvc.perform(get("/api/v1/pos/orders/{id}", orderId)
                        .param("branchId", branchId.toString()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(body).path("data");
    }

    private static JsonNode lineOf(JsonNode order, UUID itemId) {
        for (JsonNode item : order.path("items")) {
            if (itemId.toString().equals(item.path("id").asText())) {
                return item;
            }
        }
        throw new AssertionError("line " + itemId + " is not on the check");
    }

    private void setTaxBaseOverHttp(String base) throws Exception {
        mockMvc.perform(put("/api/v1/pos/tax-policy")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"taxBase\":\"" + base + "\"}"))
                .andExpect(status().isOk());
    }

    // ── The tests ────────────────────────────────────────────────────────────────────────────

    @Test
    void aLineDiscountMovesTheTaxAsWellAsTheServiceCharge() throws Exception {
        OrderDto order = openCheck();
        UUID line = addDish(order.id(), standardRatedItemId);

        // Rs 100.00 off a Rs 1,000.00 dish.
        applyDiscount(order.id(), "LINE", line, "FLAT", "100.00", "Dropped the naan");

        JsonNode row = readBack(order.id());
        assertThat(row.path("subtotalPaisa").asLong())
                .as("subtotal stays GROSS — the discount is reported beside it, not netted into it")
                .isEqualTo(100_000L);
        assertThat(row.path("discountPaisa").asLong()).isEqualTo(10_000L);
        assertThat(row.path("taxPaisa").asLong())
                .as("17%% of the Rs 900.00 actually sold, not of the Rs 1,000.00 on the menu — "
                        + "this is the assertion that failed in production, at 17000")
                .isEqualTo(15_300L);
        assertThat(row.path("serviceChargePaisa").asLong())
                .as("5%% of the same Rs 900.00 — the two charges now answer to one base")
                .isEqualTo(4_500L);
        assertThat(row.path("totalPaisa").asLong())
                .isEqualTo(100_000L - 10_000L + 15_300L + 4_500L);

        JsonNode item = lineOf(row, line);
        assertThat(item.path("discountPaisa").asLong())
                .as("the line carries its own share — order_items.discount_paisa was 0 on every "
                        + "row this product had ever written before V27")
                .isEqualTo(10_000L);
        assertThat(item.path("taxPaisa").asLong()).isEqualTo(15_300L);
        assertThat(item.path("lineTotalPaisa").asLong()).isEqualTo(90_000L + 15_300L);
    }

    @Test
    void aTenantThatHoldsTheOppositePositionKeepsTheOldArithmetic() throws Exception {
        setTaxBaseOverHttp("GROSS");

        OrderDto order = openCheck();
        UUID line = addDish(order.id(), standardRatedItemId);
        applyDiscount(order.id(), "LINE", line, "FLAT", "100.00", "Regular, twenty years");

        JsonNode row = readBack(order.id());
        assertThat(row.path("taxPaisa").asLong())
                .as("a tenant whose filed position is that the pre-discount price is the value of "
                        + "supply gets exactly the arithmetic that shipped before V27")
                .isEqualTo(17_000L);
        assertThat(row.path("serviceChargePaisa").asLong())
                .as("the service charge is the restaurant's own money and stays on the net — V27 "
                        + "makes the two agree about the DISCOUNT, not about each other's nature")
                .isEqualTo(4_500L);
        assertThat(row.path("totalPaisa").asLong())
                .isEqualTo(100_000L - 10_000L + 17_000L + 4_500L);

        // And the line records which rule priced it, so a return can be reconciled without
        // guessing which policy was in force on the day.
        assertThat(lineOf(row, line).path("taxPaisa").asLong()).isEqualTo(17_000L);
    }

    @Test
    void theTenantPolicyReadsBackAsWhatWasSet() throws Exception {
        JsonNode before = objectMapper.readTree(
                mockMvc.perform(get("/api/v1/pos/tax-policy"))
                        .andExpect(status().isOk())
                        .andReturn().getResponse().getContentAsString()).path("data");
        assertThat(before.path("taxBase").asText())
                .as("a tenant nobody has configured is NET, and says so without a row existing")
                .isEqualTo("NET");
        assertThat(before.path("configured").asBoolean())
                .as("'nobody decided and the default applies' and 'somebody chose NET' are the "
                        + "same arithmetic and different answers to an auditor")
                .isFalse();

        setTaxBaseOverHttp("GROSS");

        JsonNode after = objectMapper.readTree(
                mockMvc.perform(get("/api/v1/pos/tax-policy"))
                        .andExpect(status().isOk())
                        .andReturn().getResponse().getContentAsString()).path("data");
        assertThat(after.path("taxBase").asText()).isEqualTo("GROSS");
        assertThat(after.path("configured").asBoolean()).isTrue();
    }

    @Test
    void theLinesAndTheOrderAgree_soTheBillWillPrint() throws Exception {
        OrderDto order = openCheck();
        UUID standard = addDish(order.id(), standardRatedItemId);
        addDish(order.id(), zeroRatedItemId);
        applyDiscount(order.id(), "LINE", standard, "PERCENT", "10.00", "Waited forty minutes");
        applyOrderDiscount(order.id(), "150.00", "Manager comp");

        JsonNode row = readBack(order.id());

        long lineTax = 0L;
        long lineTotals = 0L;
        long lineDiscounts = 0L;
        for (JsonNode item : row.path("items")) {
            lineTax += item.path("taxPaisa").asLong();
            lineTotals += item.path("lineTotalPaisa").asLong();
            lineDiscounts += item.path("discountPaisa").asLong();
        }

        // The two identities ReceiptDocumentAssembler.assertMoneyIdentities THROWS on.
        assertThat(lineTax).as("Σ lineTax == order.taxPaisa").isEqualTo(row.path("taxPaisa").asLong());
        assertThat(lineTotals + lineDiscounts - lineTax)
                .as("Σ(lineTotal + lineDiscount − lineTax) == subtotal")
                .isEqualTo(row.path("subtotalPaisa").asLong());
        assertThat(lineDiscounts)
                .as("every paisa of discount is attributed to a line — an unattributed remainder "
                        + "has no rate and could not be taxed either way")
                .isEqualTo(row.path("discountPaisa").asLong());

        // Not a restatement of the above: the assembler is the thing that refuses, and a guest is
        // owed paper. This is the assertion that a cashier can actually settle the check.
        PrintDocument document = receiptAssembler.assembleReceipt(order.id(), branchId).document();
        assertThat(document.totals().tax().paisa()).isEqualTo(row.path("taxPaisa").asLong());
        assertThat(document.taxBreakdown().stream()
                .mapToLong(taxLine -> taxLine.amount().paisa()).sum())
                .as("the printed breakdown adds up to the printed tax total")
                .isEqualTo(row.path("taxPaisa").asLong());
    }

    @Test
    void anOrderLevelDiscountIsSplitAcrossTwoRatesInProportion() throws Exception {
        OrderDto order = openCheck();
        UUID standard = addDish(order.id(), standardRatedItemId);
        UUID zero = addDish(order.id(), zeroRatedItemId);

        // Rs 200.00 off a Rs 2,000.00 check of two equally-priced dishes at different rates.
        applyOrderDiscount(order.id(), "200.00", "Opening week");

        JsonNode row = readBack(order.id());
        assertThat(lineOf(row, standard).path("discountPaisa").asLong())
                .as("pro-rata: equal lines take equal shares, whatever order they were rung in")
                .isEqualTo(10_000L);
        assertThat(lineOf(row, zero).path("discountPaisa").asLong()).isEqualTo(10_000L);

        assertThat(lineOf(row, standard).path("taxPaisa").asLong())
                .as("17%% of the Rs 900.00 left of the taxed dish")
                .isEqualTo(15_300L);
        assertThat(lineOf(row, zero).path("taxPaisa").asLong())
                .as("a zero-rated dish is untaxed under either base")
                .isEqualTo(0L);

        assertThat(row.path("taxPaisa").asLong()).isEqualTo(15_300L);
        assertThat(row.path("serviceChargePaisa").asLong())
                .as("5%% of the Rs 1,800.00 net")
                .isEqualTo(9_000L);
        assertThat(row.path("totalPaisa").asLong())
                .isEqualTo(200_000L - 20_000L + 15_300L + 9_000L);
    }

    @Test
    void anIndivisibleDiscountStillSumsToItself() throws Exception {
        OrderDto order = openCheck();
        addDish(order.id(), standardRatedItemId);
        addDish(order.id(), standardRatedItemId);
        addDish(order.id(), standardRatedItemId);

        // Rs 1,000.00 across three equal lines: 33,333.33 paisa each, which does not exist.
        applyOrderDiscount(order.id(), "1000.00", "Three-way split");

        JsonNode row = readBack(order.id());
        long attributed = 0L;
        int roundedUp = 0;
        for (JsonNode item : row.path("items")) {
            long share = item.path("discountPaisa").asLong();
            attributed += share;
            assertThat(share)
                    .as("every line gets its floor or one paisa above it, never a third value")
                    .isBetween(33_333L, 33_334L);
            if (share == 33_334L) {
                roundedUp++;
            }
        }
        assertThat(attributed)
                .as("largest-remainder: the parts sum to the whole EXACTLY. Rounding each share "
                        + "independently loses a paisa and the receipt refuses the bill")
                .isEqualTo(100_000L);
        assertThat(roundedUp)
                .as("exactly one line absorbs the indivisible paisa — not none, not all three")
                .isEqualTo(1);
        assertThat(row.path("discountPaisa").asLong()).isEqualTo(100_000L);

        // A fourth line genuinely changes the allocation — pro-rata over four equal lines is a
        // quarter each, and that is the rule working, not drifting. What must NOT change is that
        // the parts still sum to the whole and that equal lines get equal shares.
        addDish(order.id(), zeroRatedItemId);
        JsonNode after = readBack(order.id());
        long reattributed = 0L;
        for (JsonNode item : after.path("items")) {
            assertThat(item.path("discountPaisa").asLong())
                    .as("four equal lines, four equal shares — no line is favoured by its position")
                    .isEqualTo(25_000L);
            reattributed += item.path("discountPaisa").asLong();
        }
        assertThat(reattributed).isEqualTo(100_000L);
    }

    /**
     * The regression V27 nearly shipped, on the path that reaches it first.
     *
     * <p>{@code recomputeOrderTotals} now WRITES {@code item.discountPaisa}, and
     * {@code lineDiscountBase} was still reading it back as though it were a prior input. Because
     * {@code applyDiscount} is replace-never-stack, the row that field was computed from has
     * ALREADY been removed by the time the replacement is priced — so the headroom was reduced by
     * a discount that no longer existed, and the guest got a smaller replacement than the manager
     * typed, silently.
     */
    @Test
    void replacingALineDiscountIsPricedAgainstTheWholeLineAgain() throws Exception {
        OrderDto order = openCheck();
        UUID line = addDish(order.id(), standardRatedItemId);

        applyDiscount(order.id(), "LINE", line, "FLAT", "100.00", "Dropped the naan");
        // Replaces it — applyDiscount removes the line's existing rows first. So this is 10% of the
        // whole Rs 1,000.00 dish, not of what was left after a discount that is already gone.
        applyDiscount(order.id(), "LINE", line, "PERCENT", "10.00", "Actually, make it ten percent");

        JsonNode row = readBack(order.id());
        assertThat(row.path("discountPaisa").asLong())
                .as("Rs 100.00. Reading the stale item.discountPaisa back as a prior input prices "
                        + "the replacement against Rs 900.00 and yields Rs 90.00")
                .isEqualTo(10_000L);
        assertThat(row.path("taxPaisa").asLong())
                .as("17%% of the Rs 900.00 left")
                .isEqualTo(15_300L);
    }

    /**
     * The same field, contaminating the other direction: {@code item.discountPaisa} also carries
     * the line's share of any ORDER-level discount, and a line discount must not be priced against
     * a base already reduced by it. The order-level share re-allocates itself on the next
     * recompute — line discounts take priority — so subtracting it up front charged the guest for
     * the same money twice.
     */
    @Test
    void aLineDiscountOnACheckThatAlreadyHasAnOrderDiscount() throws Exception {
        OrderDto order = openCheck();
        UUID line = addDish(order.id(), standardRatedItemId);

        applyOrderDiscount(order.id(), "100.00", "Opening week");
        applyDiscount(order.id(), "LINE", line, "PERCENT", "10.00", "Dropped the naan");

        JsonNode row = readBack(order.id());
        assertThat(row.path("discountPaisa").asLong())
                .as("Rs 100.00 order-level + Rs 100.00 line-level. Subtracting the order-level "
                        + "share before pricing the line discount yields Rs 190.00")
                .isEqualTo(20_000L);
        assertThat(row.path("taxPaisa").asLong())
                .as("17%% of the Rs 800.00 left")
                .isEqualTo(13_600L);
    }

    /**
     * The case a sibling session measured and deliberately did not ratify, pending this decision
     * (see {@code .planning/decisions/D-TAX-DISCOUNT.md}).
     *
     * <p>Measured before V27 on {@code OrderLifecycleIT}'s Rs 850.00 line at 5%: applying
     * {@code PERCENT 100} comped the dish and still billed the guest {@code 4250} — Rs 42.50 of tax
     * on food that was given away, because the LINE-scope discount row reduced the total without
     * ever reaching the tax base. Under the ruling, a line with nothing left to sell is taxed on
     * nothing.
     */
    @Test
    void aFullyCompedLineIsTaxedOnNothing() throws Exception {
        OrderDto order = openCheck();
        UUID line = addDish(order.id(), standardRatedItemId);

        applyDiscount(order.id(), "LINE", line, "PERCENT", "100.00", "Comped — dropped the tray");

        JsonNode row = readBack(order.id());
        assertThat(row.path("discountPaisa").asLong()).isEqualTo(100_000L);
        assertThat(row.path("taxPaisa").asLong())
                .as("the whole dish was given away; there is no consideration to charge tax on")
                .isZero();
        assertThat(row.path("serviceChargePaisa").asLong())
                .as("5%% of nothing — and the receipt still prints the line, because the branch "
                        + "HAS a policy (F20's label/amount distinction)")
                .isZero();
        assertThat(row.path("totalPaisa").asLong())
                .as("the guest owes nothing. Before V27 this check came to Rs 42.50 of pure tax")
                .isZero();
        assertThat(lineOf(row, line).path("lineTotalPaisa").asLong()).isZero();

        // And it is still printable — a comped check is one a cashier most needs paper for.
        assertThat(receiptAssembler.assembleReceipt(order.id(), branchId)
                .document().totals().grandTotal().paisa()).isZero();
    }

    @Test
    void theClosedCheckStillBalancesTheJournal() throws Exception {
        OrderDto order = openCheck();
        UUID line = addDish(order.id(), standardRatedItemId);
        applyDiscount(order.id(), "LINE", line, "FLAT", "100.00", "Dropped the naan");

        closeViaServeAndPay(orderService, paymentService,
                orderService.getOrder(order.id(), branchId), branchId);

        List<OutboxEntry> closed = outboxRepository.findAll().stream()
                .filter(entry -> "ORDER_CLOSED".equals(entry.getEventType()))
                .toList();
        assertThat(closed).as("the close must publish exactly one ORDER_CLOSED").hasSize(1);
        JsonNode payload = objectMapper.readTree(closed.get(0).getEnvelopeJson()).path("payload");

        long subtotal = payload.path("subtotalPaisa").asLong();
        long discount = payload.path("discountPaisa").asLong();
        long tax = payload.path("taxPaisa").asLong();
        long serviceCharge = payload.path("serviceChargePaisa").asLong();
        long total = payload.path("totalPaisa").asLong();

        assertThat(tax).as("the re-based tax is what reaches finance and reporting").isEqualTo(15_300L);

        // AutoPostingRecipeEngine's revenue entry, restated. Revenue is credited GROSS with the
        // discount debited to 4920 as contra-revenue; crediting it net as well double-counts the
        // discount and unbalances the entry by exactly discountPaisa, which is the defect that
        // javadoc records. Tax appears on both sides, which is why the BALANCE cannot discriminate
        // between the two bases — only the amount on Output Tax moves, and that is asserted above.
        long debits = total + discount;
        long credits = subtotal + serviceCharge + tax;
        assertThat(debits)
                .as("DR tenders + DR discount == CR gross revenue + CR service charge + CR output tax")
                .isEqualTo(credits);

        // The identity finance balances against, stated the way pos-service computes it.
        assertThat(total).isEqualTo(subtotal - discount + tax + serviceCharge);
    }
}
