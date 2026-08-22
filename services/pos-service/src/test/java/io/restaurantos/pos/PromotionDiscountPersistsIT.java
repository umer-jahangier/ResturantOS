package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.ApplyDiscountRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.feign.CrmPromotionClient;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * A CRM promotion actually coming off a bill — which, before this file, had never once happened.
 *
 * <h2>The defect this file exists to fail on</h2>
 *
 * <p>{@code OrderServiceImpl.applyPromotions} built its discount row with
 * {@code type = "PROMOTION"}. {@code order_discounts.type} has carried
 * {@code CHECK (type IN ('FLAT','PERCENT'))} since pos V1. So the endpoint
 * {@code POST /api/v1/pos/orders/{id}/promotions/apply} evaluated the offer, priced it, built the
 * row, and then died at flush:
 *
 * <pre>
 *   ERROR: new row for relation "order_discounts" violates check constraint
 *          "order_discounts_type_check"
 * </pre>
 *
 * <p>Read back live from pos_db on 2026-08-12,
 * {@code SELECT type, count(*) FROM order_discounts GROUP BY 1} returned {@code PERCENT | 4} and
 * nothing else: not one PROMOTION row had ever been written, in the whole life of the product. The
 * endpoint is reachable and gated on {@code pos.order.discount.order}, so this was a 500 waiting
 * for the first tenant to configure an offer. No test covered the path, which is why it shipped.
 *
 * <h2>Why the fix keeps the constraint and changes the engine</h2>
 *
 * <p>{@code type} is not a label, it is the unit discriminator for {@code value}: FLAT means
 * {@code value} is RUPEES ({@code computeDiscountAmount} multiplies by 100), PERCENT means it is a
 * RATE (it divides by 100). The promotion path was writing the capped PAISA figure into
 * {@code value}, so "PROMOTION" was quietly a third unit convention smuggled in as a third type —
 * and widening the CHECK would have made every reader of {@code value} guess between three.
 *
 * <p>So the offer is recorded as what it is — a flat discount of Rs X — and the fact that a machine
 * chose it moves to {@code order_discounts.source} (V30), which is where the replace-never-stack
 * rules now key off. See V30 for the full account.
 *
 * <p>These assertions run against a real Postgres 16 with the real Flyway migrations applied
 * ({@link PosTestBase}), so the CHECK constraint under test is the production one and not a mock
 * of it. Every one of them fails on the code as it stood before V30.
 */
class PromotionDiscountPersistsIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired TenantContext tenantContext;
    @Autowired JdbcTemplate jdbcTemplate;

    /** The engine itself is not under test here — what it returns is. */
    @MockitoBean CrmPromotionClient crmPromotionClient;

    UUID tenantId;
    UUID branchId;
    UUID cashierId;
    UUID customerId;
    UUID menuItemId;

    /** Rs 450.00 a plate, no tax — so every figure below is checkable by hand. */
    private static final long UNIT_PRICE_PAISA = 45_000L;

    /** Two plates: Rs 900.00. */
    private static final long SUBTOTAL_PAISA = 2 * UNIT_PRICE_PAISA;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        cashierId = UUID.randomUUID();
        customerId = UUID.randomUUID();

        JwtClaims claims = new JwtClaims(cashierId, tenantId, branchId,
                List.of("MANAGER"),
                List.of("pos.order.discount.line", "pos.order.discount.order",
                        "pos.order.discount.override"),
                Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
        tenantContext.set(tenantId, branchId, cashierId, null);

        // The manager's grant is not what this file is about — DiscountOnFiredCheckIT drives the
        // real bundle for that. Here the policy is allowed so the assertions are about where the
        // discount is RECORDED, not about who may ask for one.
        when(opaClient.evaluate(any(), any())).thenReturn(new OpaDecision(true));

        MenuCategory cat = new MenuCategory();
        cat.setTenantId(tenantId);
        cat.setName("Mains-" + UUID.randomUUID());
        cat.setSortOrder(1);
        cat = menuCategoryRepository.save(cat);

        MenuItem item = new MenuItem();
        item.setTenantId(tenantId);
        item.setCategory(cat);
        item.setName("Seekh Kebab");
        item.setBasePricePaisa(UNIT_PRICE_PAISA);
        item.setTaxRatePct(new BigDecimal("0.00"));
        item = menuItemRepository.save(item);
        menuItemId = item.getId();
    }

    /** A check with a customer attached — the only kind a tier promotion can be evaluated against. */
    private OrderDto checkOfTwoPlatesForACustomer() {
        OrderDto order = orderService.createOrder(new CreateOrderRequest(
                branchId, UUID.randomUUID(), null, null, 2, customerId, null));
        orderService.addItem(order.id(),
                new AddOrderItemRequest(menuItemId, branchId, 2, null, null));
        OrderDto rung = orderService.getOrder(order.id(), branchId);
        assertThat(rung.subtotalPaisa()).isEqualTo(SUBTOTAL_PAISA);
        assertThat(rung.totalPaisa()).isEqualTo(SUBTOTAL_PAISA);
        return rung;
    }

    private void engineOffers(long discountPaisa) {
        when(crmPromotionClient.evaluate(any()))
                .thenReturn(new CrmPromotionClient.EvaluatePromotionResponse(
                        discountPaisa, List.of(UUID.randomUUID())));
    }

    // ── (1) THE BLOCKER: the row can be written at all ────────────────────────────────────

    /**
     * Rs 150.00 off a Rs 900.00 check. Before V30 this threw a
     * {@code DataIntegrityViolationException} on the type CHECK and the caller got a 500; the
     * guest was charged the full Rs 900.00 and nothing recorded that an offer had been earned.
     */
    @Test
    void anEarnedPromotionActuallyComesOffTheBill() {
        OrderDto rung = checkOfTwoPlatesForACustomer();
        engineOffers(15_000L);

        OrderDto after = orderService.applyPromotions(rung.id());

        assertThat(after.discountPaisa())
                .as("the promotion has to move the bill, which is the entire point of it")
                .isEqualTo(15_000L);
        assertThat(after.totalPaisa()).isEqualTo(SUBTOTAL_PAISA - 15_000L);
        assertThat(after.discounts()).hasSize(1);
    }

    /**
     * The row that reaches the table, read back through the entity rather than the DTO.
     *
     * <p>{@code type} is FLAT because {@code value} is in rupees, and {@code source} carries the
     * fact that no person decided this. Asserting both together is the point: it is what stops the
     * next reader concluding that a machine-applied discount is a kind of pricing formula.
     */
    @Test
    void thePromotionRowIsAFlatDiscountWhoseSourceIsTheEngine() {
        OrderDto rung = checkOfTwoPlatesForACustomer();
        engineOffers(15_000L);
        orderService.applyPromotions(rung.id());

        // Re-read from the database rather than trusting the DTO the write returned: the whole
        // defect was that the row did not survive the flush.
        OrderDto.OrderDiscountDto row = orderService.getOrder(rung.id(), branchId).discounts().get(0);

        assertThat(row.type())
                .as("PROMOTION in `type` is what violated the V1 CHECK on every single call")
                .isEqualTo("FLAT");
        assertThat(row.source()).isEqualTo("PROMOTION");
        assertThat(row.scope()).isEqualTo("ORDER");
        assertThat(row.amountPaisa()).isEqualTo(15_000L);
        assertThat(row.value())
                .as("`value` is what was ASKED for in the unit `type` names — Rs 150.00, not 15000 paisa")
                .isEqualByComparingTo(new BigDecimal("150.0000"));
        assertThat(row.reason()).isEqualTo("Automatic promotion (customer's qualifying offer)");
        assertThat(row.appliedBy())
                .as("nobody pressed anything — the actor is genuinely absent, not merely unresolved")
                .isNull();
    }

    /**
     * The constraint that used to reject the promotion is still rejecting everything else. A fix
     * that widened the CHECK would pass every other test in this file and quietly fail this one.
     */
    @Test
    void theTypeConstraintStillRefusesAnythingThatIsNotFlatOrPercent() {
        OrderDto rung = checkOfTwoPlatesForACustomer();

        String def = jdbcTemplate.queryForObject("""
                SELECT pg_get_constraintdef(oid) FROM pg_constraint
                 WHERE conrelid = 'order_discounts'::regclass AND conname = 'order_discounts_type_check'
                """, String.class);

        assertThat(def).contains("FLAT").contains("PERCENT").doesNotContain("PROMOTION");

        Long rejected = jdbcTemplate.queryForObject("""
                SELECT count(*) FROM pg_constraint
                 WHERE conrelid = 'order_discounts'::regclass AND conname = 'order_discounts_source_check'
                """, Long.class);
        assertThat(rejected).as("V30's source CHECK must exist, not just the column").isEqualTo(1L);

        assertThat(rung.id()).isNotNull();
    }

    /**
     * Forward-compatibility with the value bound landing beside this in V29:
     * {@code CHECK (value > 0 AND (type <> 'PERCENT' OR value <= 100))}.
     *
     * <p>A promotion row is written straight onto the entity and never passes through
     * {@code ApplyDiscountRequest}, so no bean validation stands between the CRM engine and the
     * table — this path is exactly the one that would newly fail at insert once that constraint
     * exists. Two invariants keep it safe and both are asserted rather than assumed: the engine's
     * {@code discountPaisa <= 0} guard means {@code value} is at least Rs 0.01, and the promotion
     * always records FLAT, so the {@code <= 100} arm never applies to it.
     *
     * <p>If someone later teaches the promotion path to emit PERCENT with the engine's rate, this
     * fails and points at V29 before the constraint does it in production.
     */
    @Test
    void aPromotionRowSatisfiesTheIncomingValueBound() {
        OrderDto rung = checkOfTwoPlatesForACustomer();
        engineOffers(1L); // one paisa: the smallest offer the engine can return and still apply

        orderService.applyPromotions(rung.id());
        OrderDto.OrderDiscountDto row = orderService.getOrder(rung.id(), branchId).discounts().get(0);

        assertThat(row.value())
                .as("V29 will require value > 0; Rs 0.01 is the floor this path can produce")
                .isGreaterThan(BigDecimal.ZERO);
        assertThat(row.type())
                .as("a PERCENT promotion would have to honour V29's <= 100 arm; this path never emits one")
                .isEqualTo("FLAT");
        assertThat(row.amountPaisa()).isEqualTo(1L);
    }

    /**
     * Promotions are ORDER scope, always — asserted here so that if promotions ever gain LINE
     * scope, whoever does it is told at this seam.
     *
     * <h3>What this test used to assert, and why that assertion is gone</h3>
     *
     * <p>It used to add {@code assertThat(i.discountPaisa()).isZero()} for every line, on the
     * reasoning that "no line-level discount is written, so no line's tax base moves". That was
     * true when it was written and is not true now, and the change that made it false was
     * deliberate: {@code 455237b5 feat(pos): tax is charged on the line net of its share of every
     * discount} made {@code OrderServiceImpl.recomputeOrderTotals} allocate an ORDER-scope
     * discount across the billable lines pro rata and stamp each line's {@code discountPaisa},
     * {@code taxPaisa} and {@code lineTotalPaisa} together. The two commits were written the same
     * afternoon on parallel branches — neither is an ancestor of the other — so they merged
     * cleanly in text and contradicted each other in meaning, and this test has failed ever since.
     *
     * <p>The old expectation is not merely stale, it is the wrong outcome to want. An ORDER-scope
     * discount carries no tax rate of its own; the LINES do. Leaving the lines untouched would
     * charge tax on money the guest was never asked for. So the invariant worth protecting is not
     * "the lines do not move" — it is that the allocation is EXACT: every paisa of the promotion
     * lands on some line, and no paisa is invented on the way. That is what is asserted below,
     * and it is a stronger statement than the one it replaces.
     *
     * <p>The LINE-scope half of the original concern is kept and sharpened: the promotion must
     * still never write a discount ROW attached to a line ({@code scope}/{@code orderItemId}),
     * which is the thing that would drag it into the LINE-scope tax defect this file names.
     */
    @Test
    void aPromotionIsWholeCheckScopeAndItsAllocationAcrossTheLinesIsExact() {
        OrderDto rung = checkOfTwoPlatesForACustomer();
        engineOffers(15_000L);

        OrderDto after = orderService.applyPromotions(rung.id());

        assertThat(after.discounts()).allSatisfy(d -> {
            assertThat(d.scope())
                    .as("a promotion is a whole-check offer and must never be recorded as a line's")
                    .isEqualTo("ORDER");
            assertThat(d.orderItemId())
                    .as("an ORDER row pinned to a line is a LINE row wearing the wrong scope")
                    .isNull();
        });

        assertThat(after.discountPaisa()).isEqualTo(15_000L);
        assertThat(after.items().stream().mapToLong(OrderDto.OrderItemDto::discountPaisa).sum())
                .as("every paisa of the offer is attributed to a line, and not one paisa more")
                .isEqualTo(15_000L);
    }

    // ── (2) REPLACE, NEVER STACK — now keyed on `source`, not on `type` ───────────────────

    /**
     * Re-running the evaluation must be idempotent in effect. This predicate used to compare
     * {@code type} against "PROMOTION"; it now compares {@code source}, and if that rewrite had
     * been wrong the second call would stack a second Rs 150.00 off the same check.
     */
    @Test
    void reRunningTheEngineReplacesItsOwnRowInsteadOfStackingASecond() {
        OrderDto rung = checkOfTwoPlatesForACustomer();
        engineOffers(15_000L);

        orderService.applyPromotions(rung.id());
        OrderDto twice = orderService.applyPromotions(rung.id());

        assertThat(twice.discounts()).hasSize(1);
        assertThat(twice.discountPaisa()).isEqualTo(15_000L);
        assertThat(twice.totalPaisa()).isEqualTo(SUBTOTAL_PAISA - 15_000L);
    }

    /**
     * A manager's own discount replaces the previous MANUAL one and leaves the promotion standing —
     * the behaviour the pre-V30 code expressed by excluding {@code type = 'PROMOTION'} from its
     * removeIf, preserved here through {@code source}. The two were decided by different parties
     * for different reasons, so one does not overwrite the other.
     */
    @Test
    void aManagersDiscountReplacesTheManagersPreviousOneAndLeavesThePromotionAlone() {
        OrderDto rung = checkOfTwoPlatesForACustomer();
        engineOffers(15_000L);
        orderService.applyPromotions(rung.id());

        orderService.applyDiscount(rung.id(), new ApplyDiscountRequest(
                "ORDER", null, "FLAT", new BigDecimal("50.00"), "Regular's goodwill"));
        OrderDto after = orderService.applyDiscount(rung.id(), new ApplyDiscountRequest(
                "ORDER", null, "FLAT", new BigDecimal("80.00"), "Manager corrected the figure"));

        assertThat(after.discounts())
                .as("the promotion plus exactly one manual row — not two manual rows, not zero")
                .hasSize(2);
        assertThat(after.discounts()).extracting(OrderDto.OrderDiscountDto::source)
                .containsExactlyInAnyOrder("PROMOTION", "MANUAL");
        assertThat(after.discountPaisa())
                .as("Rs 150.00 automatic + Rs 80.00 manual")
                .isEqualTo(15_000L + 8_000L);
        assertThat(after.totalPaisa()).isEqualTo(SUBTOTAL_PAISA - 15_000L - 8_000L);
    }

    /** Every discount a person applies is stamped MANUAL, or the report cannot tell them apart. */
    @Test
    void aManuallyAppliedDiscountRecordsItselfAsManual() {
        OrderDto rung = checkOfTwoPlatesForACustomer();

        OrderDto after = orderService.applyDiscount(rung.id(), new ApplyDiscountRequest(
                "ORDER", null, "PERCENT", new BigDecimal("10.00"), "Waited forty minutes"));

        assertThat(after.discounts()).hasSize(1);
        assertThat(after.discounts().get(0).source()).isEqualTo("MANUAL");
        assertThat(after.discounts().get(0).type()).isEqualTo("PERCENT");
        assertThat(after.discountPaisa()).isEqualTo(9_000L);
    }

    // ── (3) THE EDGES ────────────────────────────────────────────────────────────────────

    /**
     * An offer worth more than the check it lands on. {@code amountPaisa} caps at the subtotal —
     * the bill cannot go negative — while {@code value} keeps the UNCAPPED figure the engine
     * asked for, which is the only way a reader can later see that the offer was worth more than
     * the sale. The old code wrote the capped paisa amount into both and lost that distinction.
     */
    @Test
    void anOfferBiggerThanTheCheckIsCappedWithoutLosingWhatWasOffered() {
        OrderDto rung = checkOfTwoPlatesForACustomer();
        engineOffers(120_000L);

        OrderDto after = orderService.applyPromotions(rung.id());

        assertThat(after.totalPaisa()).isZero();
        assertThat(after.discountPaisa()).isEqualTo(SUBTOTAL_PAISA);

        OrderDto.OrderDiscountDto row = orderService.getOrder(rung.id(), branchId).discounts().get(0);
        assertThat(row.amountPaisa()).as("what came OFF, capped").isEqualTo(SUBTOTAL_PAISA);
        assertThat(row.value()).as("what was ASKED for, uncapped, in rupees")
                .isEqualByComparingTo(new BigDecimal("1200.0000"));
    }

    /** A walk-in has nobody to evaluate a tier promotion against; the check is untouched. */
    @Test
    void aWalkInCheckIsLeftAlone() {
        OrderDto order = orderService.createOrder(new CreateOrderRequest(
                branchId, UUID.randomUUID(), null, null, 2, null, null));
        orderService.addItem(order.id(),
                new AddOrderItemRequest(menuItemId, branchId, 2, null, null));

        OrderDto after = orderService.applyPromotions(order.id());

        assertThat(after.discounts()).isEmpty();
        assertThat(after.totalPaisa()).isEqualTo(SUBTOTAL_PAISA);
        assertThat(after.status()).isEqualTo(OrderStatus.OPEN);
    }

    /**
     * A check with nothing on it absorbs nothing, so no row is written at all.
     *
     * <p>Flagged by the V29 session. Their stated mechanism was that {@code value} would be 0 and
     * fail V29's {@code value > 0}; that is not what happens here, because {@code value} now
     * carries the UNCAPPED figure (Rs 150.00) and would have passed. The defect is the other
     * column: {@code amountPaisa} caps to 0, so the row records a giveaway that did not occur —
     * "Automatic promotion … Rs 0.00" on the guest's bill and a zero-value line in the Discount
     * Summary. Their conclusion was right even though the constraint would not have caught it,
     * and it is worth noting that V29 would NOT have caught it: a false statement can satisfy
     * every constraint on the table.
     *
     * <p>Reachable only since the type-CHECK fix — before it, this row could not insert at all.
     */
    @Test
    void anOfferAgainstAnEmptyCheckWritesNoRowAtAll() {
        OrderDto empty = orderService.createOrder(new CreateOrderRequest(
                branchId, UUID.randomUUID(), null, null, 2, customerId, null));
        assertThat(orderService.getOrder(empty.id(), branchId).subtotalPaisa()).isZero();
        engineOffers(15_000L);

        OrderDto after = orderService.applyPromotions(empty.id());

        assertThat(after.discounts())
                .as("a discount that takes nothing off is not a discount")
                .isEmpty();
        assertThat(after.discountPaisa()).isZero();
        assertThat(after.totalPaisa()).isZero();
    }

    /**
     * The same rule one step later: a check whose lines are all cancelled. The engine still
     * offers, the cap is still 0, and still nothing is recorded — this is the shape that actually
     * occurs at a till, where a table orders, changes its mind, and the offer is re-evaluated.
     */
    @Test
    void anOfferAgainstAFullyCancelledCheckWritesNoRowAtAll() {
        OrderDto rung = checkOfTwoPlatesForACustomer();
        for (OrderDto.OrderItemDto item : rung.items()) {
            orderService.cancelItem(rung.id(), item.id());
        }
        assertThat(orderService.getOrder(rung.id(), branchId).subtotalPaisa()).isZero();
        engineOffers(15_000L);

        OrderDto after = orderService.applyPromotions(rung.id());

        assertThat(after.discounts()).isEmpty();
        assertThat(after.totalPaisa()).isZero();
    }

    /** A customer with no qualifying offer earns nothing, and that is not an error. */
    @Test
    void aCustomerWithNoQualifyingOfferGetsNoRow() {
        OrderDto rung = checkOfTwoPlatesForACustomer();
        engineOffers(0L);

        OrderDto after = orderService.applyPromotions(rung.id());

        assertThat(after.discounts()).isEmpty();
        assertThat(after.totalPaisa()).isEqualTo(SUBTOTAL_PAISA);
    }
}
