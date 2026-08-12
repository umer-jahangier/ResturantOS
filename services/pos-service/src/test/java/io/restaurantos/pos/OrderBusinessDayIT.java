package io.restaurantos.pos;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.feign.UserBranchClient;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.PaymentService;
import io.restaurantos.pos.support.BranchBusinessDay;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.event.OutboxEntry;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.tenant.TenantContext;
import io.restaurantos.shared.time.BusinessDay;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * S0-C — pos-service cuts the trading day on the BRANCH's clock, in all three places it cuts one.
 *
 * <h2>Why this test picks its own timezone at runtime</h2>
 *
 * <p>The defect is a disagreement between three clocks: UTC (what
 * {@code BusinessDay.of(Instant)} used), the JVM's default zone (what
 * {@code generateOrderNo}'s {@code LocalDate.now()} used) and the branch's (what the product
 * documents on {@code /app/settings}, and the only correct answer). Any test that pins a fixed
 * branch timezone can only catch that disagreement during the hours when those clocks happen to
 * name different days — 23:00Z–04:00Z for {@code Asia/Karachi}. A suite that is only capable of
 * failing for five hours a day is how this survived: the walkthrough that found it ran at 07:50
 * local by luck, and {@code DailyTakingsUnclosedCashIT} had asserted the UTC boundary as CORRECT
 * since the day it was written.
 *
 * <p>So {@link #anAwkwardZone()} computes, from the clock at the moment the test runs, a branch
 * offset guaranteed to put the branch's trading day on a DIFFERENT calendar date from both UTC and
 * the JVM's default zone. These assertions therefore fail against the old implementations at every
 * instant of the day, not merely at the convenient ones.
 */
class OrderBusinessDayIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired PaymentService paymentService;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired OutboxRepository outboxRepository;
    @Autowired TenantContext tenantContext;
    @Autowired BranchBusinessDay branchBusinessDay;

    // userBranchClient is @MockitoBean on PosTestBase (ActiveBranchGuard made it universal).

    private final ObjectMapper mapper = new ObjectMapper();

    UUID tenantId;
    UUID branchId;
    UUID menuItemId;
    ZoneId branchZone;

    /**
     * A fixed-offset zone on which "today" is neither UTC's today nor the JVM's today.
     *
     * <p>Walks the whole legal offset range and returns the first offset whose trading day differs
     * from BOTH of the two dates the broken code could have produced. One always exists: the
     * −12..+14 range spans 26 hours, so at every instant some offset is on a different date from
     * any given pair.
     */
    private static ZoneId anAwkwardZone() {
        Instant now = Instant.now();
        LocalDate utcAnswer = BusinessDay.of(now, ZoneOffset.UTC);          // the old shared-lib rule
        LocalDate jvmAnswer = LocalDate.now();                              // the old generateOrderNo rule
        for (int h = 14; h >= -12; h--) {
            ZoneOffset candidate = ZoneOffset.ofHours(h);
            LocalDate branchAnswer = BusinessDay.of(now, candidate);
            if (!branchAnswer.equals(utcAnswer) && !branchAnswer.equals(jvmAnswer)) {
                return candidate;
            }
        }
        throw new IllegalStateException(
                "no offset in -12..+14 disagrees with both UTC (" + utcAnswer + ") and the JVM ("
                        + jvmAnswer + ") — impossible unless the offset range changed");
    }

    @BeforeEach
    void setUp() {
        outboxRepository.deleteAll();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, UUID.randomUUID(), null);
        branchZone = anAwkwardZone();

        // The branch says what zone it is on. This is the field that was on the wire the whole
        // time and that pos-service never read — the reason shared-lib believed pos "does not hold
        // branch timezone data".
        when(userBranchClient.getBranch(any(), any())).thenReturn(new UserBranchClient.BranchDetail(
                branchId, "Awkward Terrace", null, null, null, null, null, branchZone.getId()));

        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new ApiResponse<>(
                        new FinancePeriodClient.PeriodStatusDto(UUID.randomUUID(), "OPEN", 2026, 6),
                        null, List.of()));

        MenuCategory cat = new MenuCategory();
        cat.setTenantId(tenantId);
        cat.setName("Mains-" + UUID.randomUUID());
        cat.setSortOrder(1);
        cat = menuCategoryRepository.save(cat);

        MenuItem item = new MenuItem();
        item.setTenantId(tenantId);
        item.setCategory(cat);
        item.setName("Karahi");
        item.setBasePricePaisa(25_000L);
        item.setTaxRatePct(new BigDecimal("0.00"));
        menuItemId = menuItemRepository.save(item).getId();

        openTillForCashier(branchId);
    }

    /**
     * An order that HAS a number. {@code order_no} is stamped on the DRAFT->OPEN transition — the
     * first line added — not at creation, so a bare {@code createOrder} returns a null number and
     * an assertion on it would be vacuously satisfied by a broken implementation.
     */
    private OrderDto numberedOrder() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        return orderService.addItem(
                order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
    }

    /** The trading day the branch is in, computed independently of the code under test. */
    private LocalDate expectedTradingDay(Instant at) {
        return at.atZone(branchZone).minusHours(4).toLocalDate();
    }

    // ── 1. The event finance dates the journal entry from ────────────────────────────────────

    @Test
    void orderClosed_carriesTheBranchsTradingDay_notUtcs() throws Exception {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        closeViaServeAndPay(orderService, paymentService, order, branchId);

        List<OutboxEntry> closed = outboxRepository.findAll().stream()
                .filter(e -> "ORDER_CLOSED".equals(e.getEventType()))
                .toList();
        assertThat(closed).hasSize(1);
        JsonNode payload = mapper.readTree(closed.get(0).getEnvelopeJson()).get("payload");

        Instant closedAt = Instant.parse(payload.get("closedAt").asText());
        LocalDate stamped = LocalDate.parse(payload.get("businessDate").asText());

        assertThat(stamped)
                .as("finance copies this field onto journal_entries.entry_date verbatim, so it is "
                        + "the ledger's date for this sale — it must be the branch's trading day")
                .isEqualTo(expectedTradingDay(closedAt));

        assertThat(stamped)
                .as("and it must NOT be the UTC day BusinessDay.of(Instant) — the deprecated "
                        + "overload this call site used to reach for — would have produced")
                .isNotEqualTo(BusinessDay.of(closedAt, ZoneOffset.UTC));
    }

    // ── 2. The date on the face of the ticket ────────────────────────────────────────────────

    @Test
    void orderNumber_carriesTheBranchsTradingDay_notTheJvmsCalendarDate() {
        OrderDto order = numberedOrder();

        String expected = expectedTradingDay(Instant.now())
                .format(DateTimeFormatter.BASIC_ISO_DATE);
        assertThat(order.orderNo()).as("the fixture must actually have produced a number").isNotNull();
        assertThat(order.orderNo())
                .as("ORD-YYYYMMDD-NNNN must be stamped with the trading day the sale will be "
                        + "reported under, so the ticket in the guest's hand and the Takings page "
                        + "name the same day")
                .startsWith("ORD-" + expected + "-");

        assertThat(order.orderNo())
                .as("and must NOT be the JVM host's calendar date, which is the deployment's "
                        + "business and not the restaurant's")
                .doesNotStartWith("ORD-" + LocalDate.now().format(DateTimeFormatter.BASIC_ISO_DATE) + "-");
    }

    // ── 3. The sequence row the number is drawn from ─────────────────────────────────────────

    @Test
    void theSequenceRow_isKeyedOnTheSameTradingDayTheNumberPrints() {
        OrderDto first = numberedOrder();
        OrderDto second = numberedOrder();

        // generateOrderNo used to evaluate LocalDate.now() THREE times — once for the printed
        // label and twice for the row. Two orders in one branch-day must draw from one row, and
        // the row's date must be the date printed on them.
        LocalDate expected = branchBusinessDay.currentDate(branchId);
        String label = expected.format(DateTimeFormatter.BASIC_ISO_DATE);
        assertThat(first.orderNo()).startsWith("ORD-" + label + "-");
        assertThat(second.orderNo()).startsWith("ORD-" + label + "-");

        int a = Integer.parseInt(first.orderNo().substring(first.orderNo().lastIndexOf('-') + 1));
        int b = Integer.parseInt(second.orderNo().substring(second.orderNo().lastIndexOf('-') + 1));
        assertThat(b).as("consecutive orders share one sequence row").isEqualTo(a + 1);
    }

    // ── 4. The branch zone genuinely reaches the rule ────────────────────────────────────────

    @Test
    void theBranchsOwnZoneIsWhatTheRuleUses_andAnUnreachableBranchDegradesToTheDefault() {
        assertThat(branchBusinessDay.zoneOf(branchId))
                .as("read from the branch record, not assumed")
                .isEqualTo(branchZone);

        // A branch nobody can look up must NOT stop a cashier taking money: the documented
        // fail-soft is the configured default zone, and it is asserted rather than trusted.
        when(userBranchClient.getBranch(any(), any())).thenThrow(new IllegalStateException("down"));
        assertThat(branchBusinessDay.zoneOf(UUID.randomUUID()))
                .isEqualTo(ZoneId.of("Asia/Karachi"));
    }
}
