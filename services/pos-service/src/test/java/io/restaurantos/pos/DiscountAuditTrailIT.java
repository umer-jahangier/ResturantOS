package io.restaurantos.pos;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.pos.domain.enums.OrderType;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.event.AuditEventCatalog;
import io.restaurantos.shared.event.OutboxEntry;
import io.restaurantos.shared.event.OutboxRepository;
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
 * D-2 — a discount leaves a record an owner who is not on the floor can read.
 *
 * <h2>The gap this file exists to fail on</h2>
 *
 * <p>The audit vocabulary had 27 actions. Measured 2026-08-12 by reading every option off the live
 * {@code #audit-action} select and filtering on the word: <b>none</b> of them mentioned discount,
 * comp, price or override. {@code ORDER_DISCOUNT_APPLIED} and {@code ORDER_DISCOUNTED} both
 * returned {@code 200} with {@code n=0}. {@code ORDER_VOIDED} was there, with an actor.
 *
 * <p>So a manager could take 10% off any check in the building, or comp a line, and the only
 * record was a row inside the order — findable only by someone who already knew which order to
 * open. The audit screen promises "Every sign-in, void, refund, till session, role change and
 * journal posting in this business, with who did it and when" and could not answer the one
 * question about the most abusable action at a till. Until B3 a discount could not be given at
 * all, so the gap did not exist. It exists now.
 *
 * <h2>What is asserted, and why it is not "a field is present"</h2>
 *
 * <p>Two things have to be true together, and each is useless alone. The event has to be
 * PUBLISHED, and {@link AuditEventCatalog#MUST_AUDIT} — the actual predicate
 * {@code AuditIngestionService.isAuditable} evaluates — has to ADMIT it. A published type nobody
 * allow-lists writes no row and logs nothing above DEBUG; an allow-listed type nobody publishes
 * does the same. That combination is exactly how {@code VOID_CREATED} left voids unaudited for
 * fourteen phases, and it is why both halves are asserted here on every event.
 *
 * <p>Beyond that, the payload's money is RECONCILED against the order read back over HTTP:
 * {@code amountPaisa} equals the check's discount and {@code orderTotalPaisa} equals its total. An
 * audit row that records a different figure from the one the guest was charged is worse than no
 * row, because it will be believed.
 *
 * <h2>Falsification — watched</h2>
 *
 * <ul>
 *   <li>Rename the published constant (e.g. {@code "ORDER_DISCOUNT_APPLIED_X"}) and
 *       {@code AuditAllowListClosureTest} fails in BOTH directions —
 *       {@code Expecting empty but was: ["ORDER_DISCOUNT_APPLIED"]} for the orphaned allow-list
 *       entry and {@code ["ORDER_DISCOUNT_APPLIED_X"]} for the unclassified published type. That
 *       was run; it is the string-mismatch failure mode this whole mechanism exists to catch.</li>
 *   <li>Delete the {@code eventPublisher.publish} calls from {@code applyDiscount} and every test
 *       here fails on an empty outbox.</li>
 *   <li>{@link #replacingADiscountAnnouncesWhatWasTakenBack} fails against an implementation that
 *       drops the displaced rows with a bare {@code removeIf}, which is what shipped: the
 *       replacement is announced and the Rs 400.00 handed back to the guest is not.</li>
 * </ul>
 */
class DiscountAuditTrailIT extends PosTestBase {

    private static final long DISH_PAISA = 100_000L;
    private static final BigDecimal STANDARD_RATE = new BigDecimal("16.00");

    @Autowired WebApplicationContext webApplicationContext;
    @Autowired ObjectMapper objectMapper;
    @Autowired OrderService orderService;
    @Autowired OutboxRepository outboxRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired TenantContext tenantContext;

    MockMvc mockMvc;

    UUID tenantId;
    UUID branchId;
    UUID managerId;
    UUID dishId;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext).build();
        outboxRepository.deleteAll();

        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        managerId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, managerId, null);

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

        List<String> permissions = List.of(
                "pos.order.view", "pos.order.create", "pos.order.update", "pos.order.send_to_kds",
                "pos.order.discount.line", "pos.order.discount.order", "pos.menu.view");
        JwtClaims claims = new JwtClaims(
                managerId, tenantId, branchId,
                List.of("OWNER"), permissions, Map.of("approval_limit_paisa", 30_000_000L), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null,
                        permissions.stream().map(SimpleGrantedAuthority::new).toList()));

        openTillForCashier(branchId);
    }

    // ── Driving the check, and reading the trail ─────────────────────────────────────────────

    private OrderDto openCheck() {
        return orderService.createOrder(new CreateOrderRequest(
                branchId, UUID.randomUUID(), OrderType.TAKEAWAY, null, 2, null, null));
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

    private void applyDiscount(UUID orderId, Map<String, Object> body) throws Exception {
        mockMvc.perform(post("/api/v1/pos/orders/{id}/discounts", orderId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk());
    }

    private JsonNode readBack(UUID orderId) throws Exception {
        String body = mockMvc.perform(get("/api/v1/pos/orders/{id}", orderId)
                        .param("branchId", branchId.toString()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(body).path("data");
    }

    /**
     * Every envelope of one type, in the order they were written.
     *
     * <p>Read from {@code event_outbox} rather than from a broker mock, because the outbox row is
     * what actually commits with the discount — that is the whole point of the pattern, and a
     * publisher asserted through a mock can pass while the row that carries it never exists.
     */
    private List<JsonNode> envelopesOfType(String eventType) {
        return outboxRepository.findAll().stream()
                .filter(e -> eventType.equals(e.getEventType()))
                .sorted(java.util.Comparator.comparing(OutboxEntry::getCreatedAt))
                .map(e -> {
                    try {
                        return objectMapper.readTree(e.getEnvelopeJson());
                    } catch (Exception ex) {
                        throw new AssertionError("outbox envelope is not JSON", ex);
                    }
                })
                .toList();
    }

    /**
     * The two conditions that have to hold TOGETHER for an event to become an audit row, asserted
     * together so neither can be satisfied alone. See the class javadoc.
     */
    private void assertReachesTheAuditLog(String eventType, JsonNode envelope) {
        assertThat(AuditEventCatalog.MUST_AUDIT)
                .as("%s is published, but audit-service's own allow-list does not admit it — so "
                        + "ingestion matches nothing, writes nothing and logs nothing. This is the "
                        + "exact shape that left voids unaudited for fourteen phases.", eventType)
                .contains(eventType);
        assertThat(envelope.path("eventType").asText()).isEqualTo(eventType);
        assertThat(envelope.path("actorId").asText())
                .as("WHO. Taken from the verified JWT by DomainEventPublisher and read from the "
                        + "envelope by AuditIngestionService.resolveActor — a row that cannot say "
                        + "who gave the money away answers nothing an owner asked.")
                .isEqualTo(managerId.toString());
        assertThat(envelope.path("tenantId").asText()).isEqualTo(tenantId.toString());
        assertThat(envelope.path("branchId").asText()).isEqualTo(branchId.toString());
    }

    // ── The tests ────────────────────────────────────────────────────────────────────────────

    @Test
    void takingTenPercentOffTheCheckIsAnnouncedWithTheActorAndTheMoney() throws Exception {
        OrderDto order = openCheck();
        addDish(order.id());

        applyDiscount(order.id(), Map.of(
                "scope", "ORDER", "type", "PERCENT", "value", new BigDecimal("10"),
                "reason", "Regular of twenty years"));

        List<JsonNode> applied = envelopesOfType("ORDER_DISCOUNT_APPLIED");
        assertThat(applied)
                .as("one discount, one event — the action the log had no word for")
                .hasSize(1);

        JsonNode envelope = applied.get(0);
        assertReachesTheAuditLog("ORDER_DISCOUNT_APPLIED", envelope);

        JsonNode payload = envelope.path("payload");
        assertThat(payload.path("orderId").asText()).isEqualTo(order.id().toString());
        assertThat(payload.path("scope").asText()).isEqualTo("ORDER");
        assertThat(payload.path("type").asText()).isEqualTo("PERCENT");
        assertThat(payload.path("value").asDouble()).isEqualTo(10.0);
        assertThat(payload.path("reason").asText()).isEqualTo("Regular of twenty years");
        assertThat(payload.path("orderItemId").isNull())
                .as("a whole-check discount came off no particular line")
                .isTrue();

        // RECONCILIATION. The money in the record is the money on the check, read back over HTTP
        // after commit — not the figure the writing call happened to return.
        JsonNode charged = readBack(order.id());
        assertThat(payload.path("amountPaisa").asLong())
                .as("10%% of Rs 1,000.00")
                .isEqualTo(10_000L)
                .isEqualTo(charged.path("discountPaisa").asLong());
        assertThat(payload.path("orderTotalPaisa").asLong())
                .as("the bill AFTERWARDS, so the concession can be read against the check's size "
                        + "without a second query")
                .isEqualTo(charged.path("totalPaisa").asLong());
    }

    @Test
    void compingOneLineNamesTheDishItCameOff() throws Exception {
        OrderDto order = openCheck();
        UUID line = addDish(order.id());

        applyDiscount(order.id(), Map.of(
                "scope", "LINE", "orderItemId", line, "type", "PERCENT",
                "value", new BigDecimal("100"), "reason", "Sent back twice"));

        List<JsonNode> applied = envelopesOfType("ORDER_DISCOUNT_APPLIED");
        assertThat(applied).hasSize(1);
        assertReachesTheAuditLog("ORDER_DISCOUNT_APPLIED", applied.get(0));

        JsonNode payload = applied.get(0).path("payload");
        assertThat(payload.path("scope").asText()).isEqualTo("LINE");
        assertThat(payload.path("orderItemId").asText()).isEqualTo(line.toString());
        assertThat(payload.path("itemName").asText())
                .as("the dish by name, so a day of concessions reads without a join into "
                        + "order_items")
                .isEqualTo("Mutton Karahi");

        JsonNode charged = readBack(order.id());
        assertThat(payload.path("amountPaisa").asLong())
                .as("the whole dish comped")
                .isEqualTo(DISH_PAISA)
                .isEqualTo(charged.path("discountPaisa").asLong());
    }

    @Test
    void replacingADiscountAnnouncesWhatWasTakenBack() throws Exception {
        OrderDto order = openCheck();
        addDish(order.id());

        // Rs 500.00 off, then 10% instead. applyDiscount REPLACES rather than stacks, so the
        // second call hands the guest back Rs 400.00 — real money, and before D-2 its only trace
        // was the disappearance of a row.
        applyDiscount(order.id(), Map.of(
                "scope", "ORDER", "type", "FLAT", "value", new BigDecimal("500.00"),
                "reason", "Long wait on the mains"));
        applyDiscount(order.id(), Map.of(
                "scope", "ORDER", "type", "PERCENT", "value", new BigDecimal("10"),
                "reason", "Corrected — 10% is the policy"));

        List<JsonNode> removed = envelopesOfType("ORDER_DISCOUNT_REMOVED");
        assertThat(removed)
                .as("the withdrawal of the first discount is an event in its own right")
                .hasSize(1);
        assertReachesTheAuditLog("ORDER_DISCOUNT_REMOVED", removed.get(0));

        JsonNode gone = removed.get(0).path("payload");
        assertThat(gone.path("amountPaisa").asLong())
                .as("Rs 500.00 stopped coming off — the money handed back to the restaurant")
                .isEqualTo(50_000L);
        assertThat(gone.path("type").asText()).isEqualTo("FLAT");
        assertThat(gone.path("reason").asText())
                .as("the reason the withdrawn discount had been given, not the new one's")
                .isEqualTo("Long wait on the mains");
        assertThat(gone.path("removedBecause").asText()).contains("Replaced");

        // Both applies are on the record too, so the sequence reads as the correction it was.
        assertThat(envelopesOfType("ORDER_DISCOUNT_APPLIED")).hasSize(2);

        JsonNode charged = readBack(order.id());
        assertThat(charged.path("discounts").size())
                .as("replace, never stack — one discount on the check")
                .isEqualTo(1);
        assertThat(charged.path("discountPaisa").asLong())
                .as("only the 10% survives")
                .isEqualTo(10_000L);
    }

    @Test
    void aPreviewIsNotAnAuditEvent() throws Exception {
        OrderDto order = openCheck();
        addDish(order.id());

        mockMvc.perform(post("/api/v1/pos/orders/{id}/discounts/preview", order.id())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "scope", "ORDER", "type", "PERCENT", "value", new BigDecimal("10"),
                                "reason", "Just checking"))))
                .andExpect(status().isOk());

        assertThat(envelopesOfType("ORDER_DISCOUNT_APPLIED"))
                .as("asking what a discount would do is not giving one — an audit log that cannot "
                        + "tell the two apart is noise, and noise is how a real concession hides")
                .isEmpty();
        assertThat(envelopesOfType("ORDER_DISCOUNT_REMOVED")).isEmpty();
    }
}
