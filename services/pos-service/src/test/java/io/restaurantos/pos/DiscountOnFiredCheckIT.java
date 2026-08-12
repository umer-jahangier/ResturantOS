package io.restaurantos.pos;

import io.restaurantos.pos.authz.PosAuthorizationService;
import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.ApplyDiscountRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.PaymentService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.authz.DefaultOpaClient;
import io.restaurantos.shared.authz.OpaClient;
import io.restaurantos.shared.exception.FieldValidationException;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.exception.StateInvalidException;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.client.RestClient;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.utility.MountableFile;

import java.math.BigDecimal;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * A discount on a check that has already gone to the kitchen — which is every check a guest ever
 * asks for one on.
 *
 * <h2>The defect this file exists to fail on (B3)</h2>
 *
 * <p>{@code OrderServiceImpl.applyDiscount} refused anything whose status was not {@code OPEN}.
 * Measured through the gateway on 2026-08-12 as both personas and at both scopes:
 *
 * <pre>
 *   cashier LINE  on SENT_TO_KDS → 409 Cannot apply discount to order in status: SENT_TO_KDS
 *   cashier ORDER on SENT_TO_KDS → 409 (same)
 *   manager LINE  on SENT_TO_KDS → 409 (same)
 *   manager ORDER on SENT_TO_KDS → 409 (same)
 * </pre>
 *
 * <p>And a second defect underneath it, which the state rule was hiding: a {@code LINE}-scope
 * discount priced, persisted and returned correctly and moved the bill by <b>zero paisa</b>,
 * because {@code recomputeOrderTotals} summed only {@code OrderItem.discountPaisa} and
 * {@code OrderDiscount} rows whose scope is {@code "ORDER"}. Nothing matched a LINE-scope row.
 *
 * <h2>Falsification — how each test was watched to fail</h2>
 *
 * <ul>
 *   <li>{@link #cashierTakesTenPercentOffOneLineOfAFiredCheck} — restore
 *       {@code if (order.getStatus() != OrderStatus.OPEN) throw ...} and it fails on the
 *       {@code applyDiscount} call with the production 409 text. Restore only the
 *       {@code recomputeOrderTotals} body and it fails instead on {@code totalPaisa}, which stays
 *       at the undiscounted figure — the silent half of the defect.</li>
 *   <li>{@link #aDiscountWithoutAReasonIsRefused} fails with no exception at all against the
 *       pre-B3 record, which had no {@code reason} component to omit.</li>
 *   <li>{@link #cashierIsRefusedTheWholeCheckDiscountAndTheBillIsUntouched} fails against a
 *       policy or a service that lets a line-only cashier take a percentage off the whole
 *       check.</li>
 * </ul>
 *
 * <p>Real OPA, real {@code policies/} bundle — same construction and same rationale as
 * {@code VoidOwnOrderIT}: a test that mocks the decision proves only what the test decided.
 */
class DiscountOnFiredCheckIT extends PosTestBase {

    @SuppressWarnings("resource")
    private static final GenericContainer<?> OPA =
            new GenericContainer<>(DockerImageName.parse("openpolicyagent/opa:1.17.1"))
                    .withCommand("run", "--server", "--addr=0.0.0.0:8181", "/policies")
                    .withExposedPorts(8181)
                    .withCopyFileToContainer(MountableFile.forHostPath(policiesDir()), "/policies")
                    .waitingFor(Wait.forHttp("/health").forPort(8181));

    static {
        OPA.start();
    }

    private static Path policiesDir() {
        Path cwd = Path.of(System.getProperty("user.dir")).toAbsolutePath();
        for (Path candidate : List.of(
                cwd.resolve("../../policies").normalize(),
                cwd.resolve("policies").normalize(),
                cwd.resolve("../../../policies").normalize())) {
            if (candidate.resolve("restaurantos/pos.rego").toFile().exists()) {
                return candidate;
            }
        }
        throw new IllegalStateException("Could not locate policies/ from " + cwd);
    }

    /**
     * Positive control, and NOT an afterthought: an OPA holding no bundle answers {@code /health}
     * 200 and denies everything, which would turn every refusal assertion below into a pass. This
     * proves the engine is deciding before anything else is believed.
     */
    @Test
    void assertPolicyBundleIsActuallyLoaded() {
        String modules = RestClient.builder().baseUrl(opaBaseUrl())
                .requestFactory(new JdkClientHttpRequestFactory()).build()
                .get().uri("/v1/policies").retrieve().body(String.class);
        assertThat(modules)
                .as("OPA is serving no policy module — every denial below would be meaningless")
                .contains("restaurantos/pos.rego");
    }

    private static String opaBaseUrl() {
        return "http://" + OPA.getHost() + ":" + OPA.getMappedPort(8181);
    }

    @Autowired OrderService orderService;
    @Autowired PaymentService paymentService;
    @Autowired PosAuthorizationService posAuthorizationService;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired OrderRepository orderRepository;
    @Autowired TenantContext tenantContext;
    @Autowired JdbcTemplate jdbcTemplate;

    UUID tenantId;
    UUID branchId;
    UUID cashierId;
    UUID menuItemId;

    /** Rs 450.00 a plate, no tax — so every figure below is checkable by hand. */
    private static final long UNIT_PRICE_PAISA = 45_000L;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        cashierId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, cashierId, null);

        OpaClient live = new DefaultOpaClient(RestClient.builder()
                .baseUrl(opaBaseUrl())
                .requestFactory(new JdkClientHttpRequestFactory())
                .build());
        when(opaClient.evaluate(any(), any()))
                .thenAnswer(call -> live.evaluate(call.getArgument(0), call.getArgument(1)));

        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new ApiResponse<>(
                        new FinancePeriodClient.PeriodStatusDto(UUID.randomUUID(), "OPEN", 2026, 8),
                        null, List.of()));

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

        // The cashier's real grant: line discounts, and NOT the whole-check override.
        asCashier();
        openTillForCashier(branchId);
    }

    private void asCashier() {
        setSecurityContext(cashierId, List.of("CASHIER"),
                List.of("pos.order.discount.line"));
    }

    private void asManager(UUID managerId) {
        setSecurityContext(managerId, List.of("MANAGER"),
                List.of("pos.order.discount.line", "pos.order.discount.order",
                        "pos.order.discount.override"));
    }

    /**
     * Both halves of "who is asking", because production sets both: the gateway's filter populates
     * {@link TenantContext} from the same validated JWT that becomes the security principal.
     * Setting only the principal made {@code appliedBy} keep the previous user — caught by
     * {@link #managerTakesTenPercentOffTheWholeFiredCheck}, which is the assertion that exists to
     * prove the report names the person who authorised the discount and not the one who rang the
     * check.
     */
    private void setSecurityContext(UUID userId, List<String> roles, List<String> permissions) {
        JwtClaims claims = new JwtClaims(userId, tenantId, branchId, roles, permissions,
                Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
        tenantContext.set(tenantId, branchId, userId, null);
    }

    /** Two plates, rung and FIRED — the state a bill is actually presented in. */
    private OrderDto firedCheckOfTwoPlates() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 2, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 2, null, null));
        orderService.sendToKds(order.id(), null);
        OrderDto fired = orderService.getOrder(order.id(), branchId);
        assertThat(fired.status()).isEqualTo(OrderStatus.SENT_TO_KDS);
        assertThat(fired.totalPaisa()).isEqualTo(2 * UNIT_PRICE_PAISA);
        return fired;
    }

    // ── (1) THE BLOCKER: the cashier discounts a line of a check already at the pass ───────

    /**
     * A guest complains about one dish on a check that is already cooking. The cashier takes 10%
     * off that line, with a reason, and the bill moves by exactly that much.
     */
    @Test
    void cashierTakesTenPercentOffOneLineOfAFiredCheck() {
        OrderDto fired = firedCheckOfTwoPlates();
        UUID lineId = fired.items().get(0).id();

        OrderDto after = orderService.applyDiscount(fired.id(), new ApplyDiscountRequest(
                "LINE", lineId, "PERCENT", new BigDecimal("10"), "Kebab was cold"));

        // 10% of 2 × Rs 450.00 = Rs 90.00. To the paisa, no float anywhere on the path.
        assertThat(after.discountPaisa()).isEqualTo(9_000L);
        assertThat(after.subtotalPaisa()).isEqualTo(90_000L);
        assertThat(after.totalPaisa()).isEqualTo(81_000L);

        // Read the row back from Postgres — the DTO is what the screen shows, the row is what the
        // ledger and the report will later read.
        Persisted row = readBack(fired.id());
        assertThat(row.discountPaisa()).isEqualTo(9_000L);
        assertThat(row.totalPaisa()).isEqualTo(81_000L);
        assertThat(row.discounts()).hasSize(1);
        assertThat(row.discounts().get(0).scope()).isEqualTo("LINE");
        assertThat(row.discounts().get(0).orderItemId()).isEqualTo(lineId);
        assertThat(row.discounts().get(0).amountPaisa()).isEqualTo(9_000L);
        assertThat(row.discounts().get(0).reason()).isEqualTo("Kebab was cold");
        assertThat(row.discounts().get(0).appliedBy()).isEqualTo(cashierId);

        // And the identity the customer receipt refuses to print without.
        assertThat(row.subtotalPaisa() - row.discountPaisa() + row.taxPaisa()
                + row.serviceChargePaisa())
                .isEqualTo(row.totalPaisa());

        // The same figures on the wire, so the charge page and the printed bill read one truth.
        OrderDto reread = orderService.getOrder(fired.id(), branchId);
        assertThat(reread.totalPaisa()).isEqualTo(81_000L);
        assertThat(reread.discounts()).hasSize(1);
        assertThat(reread.discounts().get(0).reason()).isEqualTo("Kebab was cold");
        assertThat(reread.discounts().get(0).itemName()).isEqualTo("Seekh Kebab");
    }

    // ── (2) the reason is not optional ────────────────────────────────────────────────────

    /**
     * Money leaves the business on this call, so the call has to say why. Blank, whitespace and
     * a one-character shrug are all refused — the last one because "x" is what a mandatory field
     * becomes when the minimum is one character.
     */
    @Test
    void aDiscountWithoutAReasonIsRefused() {
        OrderDto fired = firedCheckOfTwoPlates();
        UUID lineId = fired.items().get(0).id();

        for (String noReason : new String[]{null, "", "   ", "x"}) {
            assertThatThrownBy(() -> orderService.applyDiscount(fired.id(),
                    new ApplyDiscountRequest("LINE", lineId, "PERCENT", new BigDecimal("10"), noReason)))
                    .as("reason %s must be refused", noReason == null ? "null" : "'" + noReason + "'")
                    .isInstanceOf(FieldValidationException.class)
                    .hasMessageContaining("Say why");
        }

        assertThat(readBack(fired.id()).totalPaisa())
                .as("a refused discount must not have moved the bill")
                .isEqualTo(90_000L);
    }

    // ── (3) the split: line is the cashier's, whole-check is the manager's ────────────────

    /**
     * The same cashier, the same fired check, asking for a percentage off the WHOLE bill. The
     * real policy refuses — and the check is left exactly as it was, not half-discounted.
     */
    @Test
    void cashierIsRefusedTheWholeCheckDiscountAndTheBillIsUntouched() {
        OrderDto fired = firedCheckOfTwoPlates();

        assertThatThrownBy(() -> orderService.applyDiscount(fired.id(), new ApplyDiscountRequest(
                "ORDER", null, "PERCENT", new BigDecimal("10"), "Regular customer")))
                .isInstanceOf(PermissionDeniedException.class);

        Persisted row = readBack(fired.id());
        assertThat(row.discountPaisa()).isZero();
        assertThat(row.totalPaisa()).isEqualTo(90_000L);
        assertThat(row.discounts()).isEmpty();
    }

    /** The manager holds the override, so the same request on the same fired check succeeds. */
    @Test
    void managerTakesTenPercentOffTheWholeFiredCheck() {
        OrderDto fired = firedCheckOfTwoPlates();

        UUID managerId = UUID.randomUUID();
        asManager(managerId);
        OrderDto after = orderService.applyDiscount(fired.id(), new ApplyDiscountRequest(
                "ORDER", null, "PERCENT", new BigDecimal("10"), "Regular of twenty years"));

        assertThat(after.discountPaisa()).isEqualTo(9_000L);
        assertThat(after.totalPaisa()).isEqualTo(81_000L);

        Persisted.Discount discount = readBack(fired.id()).discounts().get(0);
        assertThat(discount.scope()).isEqualTo("ORDER");
        assertThat(discount.orderItemId()).isNull();
        assertThat(discount.reason()).isEqualTo("Regular of twenty years");
        assertThat(discount.appliedBy())
                .as("the report must name the manager who authorised it, not the cashier who rang it")
                .isEqualTo(managerId);
    }

    // ── (4) replace, never stack ──────────────────────────────────────────────────────────

    /**
     * A double-tap on 10% is 10% off, not 19%. Stacking is the accident that turns a discount
     * control into a hole in the till.
     */
    @Test
    void reApplyingADiscountToTheSameLineReplacesItRatherThanStacking() {
        OrderDto fired = firedCheckOfTwoPlates();
        UUID lineId = fired.items().get(0).id();

        orderService.applyDiscount(fired.id(), new ApplyDiscountRequest(
                "LINE", lineId, "PERCENT", new BigDecimal("10"), "Kebab was cold"));
        OrderDto after = orderService.applyDiscount(fired.id(), new ApplyDiscountRequest(
                "LINE", lineId, "PERCENT", new BigDecimal("10"), "Kebab was cold"));

        assertThat(after.discountPaisa()).isEqualTo(9_000L);
        assertThat(after.totalPaisa()).isEqualTo(81_000L);
        assertThat(readBack(fired.id()).discounts()).hasSize(1);
    }

    // ── (5) the states where a discount is genuinely the wrong instrument ─────────────────

    /**
     * The guest has paid. Taking the bill down now means handing money back, which is a refund —
     * and the refusal says so in words a cashier can act on, naming neither a status enum nor a
     * permission code.
     */
    @Test
    void aFullyPaidCheckIsRefusedInWordsThatNameTheRightInstrument() {
        OrderDto fired = firedCheckOfTwoPlates();
        UUID lineId = fired.items().get(0).id();
        payInFull(fired.id(), 90_000L);

        assertThatThrownBy(() -> orderService.applyDiscount(fired.id(), new ApplyDiscountRequest(
                "LINE", lineId, "PERCENT", new BigDecimal("10"), "Kebab was cold")))
                .isInstanceOf(StateInvalidException.class)
                .hasMessageContaining("paid in full")
                .hasMessageContaining("Refund")
                .as("a refusal must not leak the status enum at the operator")
                .hasMessageNotContaining("SENT_TO_KDS");
    }

    /**
     * A closed check has had its sale posted to the ledger. Reducing its total afterwards would
     * make the paper, the row and the journal entry disagree — so the refusal names the refund.
     */
    @Test
    void aClosedCheckIsRefusedInPlainEnglish() {
        OrderDto fired = firedCheckOfTwoPlates();
        UUID lineId = fired.items().get(0).id();
        OrderDto closed = closeViaServeAndPay(orderService, paymentService, fired, branchId);
        assertThat(closed.status()).isEqualTo(OrderStatus.CLOSED);

        assertThatThrownBy(() -> orderService.applyDiscount(fired.id(), new ApplyDiscountRequest(
                "LINE", lineId, "PERCENT", new BigDecimal("10"), "Kebab was cold")))
                .isInstanceOf(StateInvalidException.class)
                .hasMessageContaining("Refund")
                .as("a refusal must not leak the status enum at the operator")
                .hasMessageNotContaining("CLOSED");
    }

    // ── (6) the value is BOUNDED, not merely positive ─────────────────────────────────────

    /**
     * A percentage over 100 is refused, and 100 itself is not.
     *
     * <p>Measured on 2026-08-12 as the Terrace cashier, on ORD-20260812-0356:
     * {@code {"scope":"LINE","type":"PERCENT","value":500}} answered <b>200 OK</b> and persisted
     * {@code value=500, amountPaisa=8000} — the whole line. The money was never at risk, because
     * {@code OrderPricingCalculator.effectiveDiscount} caps the amount at the line's headroom and
     * the bill cannot go negative. What was wrong is the <em>record</em>: the stored {@code value},
     * the guest-facing bill line and the Discount Summary report's "Discount Value" column all
     * stated a 500% discount, and the charge page printed
     * "500% off Butter Naan … −Rs 80.00" at a guest.
     *
     * <p>The screen already refused it — {@code discount-panel.tsx} disables submit with
     * "A percentage cannot be more than 100." So the UI was the strong gate and the API the weak
     * one, which is the inverse of the arrangement this codebase wants. The refusal below is
     * therefore worded the same as the screen's: an operator who hits it through either door reads
     * one sentence, not two.
     *
     * <h2>Falsification</h2>
     *
     * <p>Against the pre-fix service this fails on the FIRST iteration with
     * {@code Expecting code to raise a throwable} — 500% is accepted, priced, and written. The
     * {@code hasSize(0)} read-back is the second half: it proves the row never reached Postgres,
     * not merely that the caller saw an exception.
     *
     * <p>The 100% leg is the guard against fixing this with {@code >=}: comping a line in full is
     * a legitimate, everyday thing to do, and a bound that refused it would be a new defect.
     */
    @Test
    void aPercentageOverOneHundredIsRefused() {
        OrderDto fired = firedCheckOfTwoPlates();
        UUID lineId = fired.items().get(0).id();

        for (String tooMuch : new String[]{"500", "101", "100.01"}) {
            assertThatThrownBy(() -> orderService.applyDiscount(fired.id(), new ApplyDiscountRequest(
                    "LINE", lineId, "PERCENT", new BigDecimal(tooMuch), "Five hundred percent, re-verified")))
                    .as("PERCENT %s must be refused", tooMuch)
                    .isInstanceOf(FieldValidationException.class)
                    .hasMessageContaining("cannot be more than 100");
        }

        Persisted untouched = readBack(fired.id());
        assertThat(untouched.discounts())
                .as("a refused percentage must not have reached the table")
                .isEmpty();
        assertThat(untouched.totalPaisa()).isEqualTo(90_000L);

        // 100 is the ceiling, not a refusal — comping a line in full is an everyday thing to do.
        OrderDto comped = orderService.applyDiscount(fired.id(), new ApplyDiscountRequest(
                "LINE", lineId, "PERCENT", new BigDecimal("100"), "Comped, dish sent back"));
        assertThat(comped.discountPaisa()).isEqualTo(90_000L);
        assertThat(comped.totalPaisa()).isZero();
        assertThat(readBack(fired.id()).discounts().get(0).amountPaisa()).isEqualTo(90_000L);
    }

    /**
     * Zero and negative, at both types.
     *
     * <p>{@code @Positive} on the DTO already refuses these — but only on the {@code @Valid}
     * controller argument. This suite calls {@link OrderService} directly, as would an internal
     * endpoint, a batch job or a listener, and every one of those doors bypasses bean validation
     * entirely. That is the same reason {@code reason} is checked twice, and the reason a
     * negative discount — which would ADD money to the bill and print as a discount — has to be
     * refused by the service rather than by an annotation nobody on this path reads.
     *
     * <p>Against the pre-fix service every iteration fails with no exception raised.
     */
    @Test
    void aDiscountOfZeroOrLessIsRefused() {
        OrderDto fired = firedCheckOfTwoPlates();
        UUID lineId = fired.items().get(0).id();

        for (String type : new String[]{"PERCENT", "FLAT"}) {
            for (String notPositive : new String[]{"0", "0.00", "-5"}) {
                assertThatThrownBy(() -> orderService.applyDiscount(fired.id(),
                        new ApplyDiscountRequest("LINE", lineId, type, new BigDecimal(notPositive),
                                "Fat-fingered the keypad")))
                        .as("%s %s must be refused", type, notPositive)
                        .isInstanceOf(FieldValidationException.class)
                        .hasMessageContaining("more than zero");
            }
        }

        Persisted untouched = readBack(fired.id());
        assertThat(untouched.discounts()).isEmpty();
        assertThat(untouched.totalPaisa()).isEqualTo(90_000L);
    }

    /**
     * A FLAT discount is bounded by what is actually left, at both scopes.
     *
     * <p>The bound is not a number written beside the clamp — it is the clamp: the service refuses
     * exactly what {@code OrderPricingCalculator.effectiveDiscount} would have silently reduced. So
     * Rs 900.01 against a Rs 900.00 line is refused by one paisa, and Rs 900.00 exactly is allowed,
     * without either figure being restated anywhere in the service.
     *
     * <p>Against the pre-fix service every leg fails with no exception raised: the oversized amount
     * was accepted, clamped to the headroom, and persisted at its face value, so the row and the
     * printed bill disagreed about how much came off.
     */
    @Test
    void aFlatDiscountLargerThanWhatIsLeftIsRefused() {
        OrderDto fired = firedCheckOfTwoPlates();
        UUID lineId = fired.items().get(0).id();

        // The line holds Rs 900.00 (2 × Rs 450.00). One paisa more is one paisa too many.
        assertThatThrownBy(() -> orderService.applyDiscount(fired.id(), new ApplyDiscountRequest(
                "LINE", lineId, "FLAT", new BigDecimal("900.01"), "Comped, whole dish sent back")))
                .isInstanceOf(FieldValidationException.class)
                .hasMessageContaining("more than the");

        // The whole-check scope is bounded by the check, and is the manager's to give.
        UUID managerId = UUID.randomUUID();
        asManager(managerId);
        assertThatThrownBy(() -> orderService.applyDiscount(fired.id(), new ApplyDiscountRequest(
                "ORDER", null, "FLAT", new BigDecimal("900.01"), "Regular of twenty years")))
                .isInstanceOf(FieldValidationException.class)
                .hasMessageContaining("more than the");

        assertThat(readBack(fired.id()).discounts())
                .as("neither refusal may have written a row")
                .isEmpty();

        // Exactly the headroom is not "more than" the headroom — the boundary is inclusive.
        OrderDto whole = orderService.applyDiscount(fired.id(), new ApplyDiscountRequest(
                "ORDER", null, "FLAT", new BigDecimal("900.00"), "Regular of twenty years"));
        assertThat(whole.totalPaisa()).isZero();
        assertThat(readBack(fired.id()).discounts().get(0).amountPaisa()).isEqualTo(90_000L);
    }

    // ── (7) the database's own bound, and what it means for the promotion engine ──────────

    /**
     * V29's CHECK, read back from the catalogue and evaluated against the exact shapes the
     * promotion engine produces.
     *
     * <h2>Why this test exists at all</h2>
     *
     * <p>{@code applyPromotions} is the one other path that writes an {@code order_discounts} row,
     * and it writes {@code value = BigDecimal.valueOf(capped)} where {@code capped} is PAISA — not
     * rupees, not a percentage. That has never corrupted anything only because the row cannot be
     * inserted at all today: it sets {@code type = "PROMOTION"}, which V1's own
     * {@code CHECK (type IN ('FLAT','PERCENT'))} rejects at flush. A sibling change is giving
     * promotions a real {@code type} and a {@code source} column, and the moment it lands those
     * rows become insertable for the first time.
     *
     * <p>V29 is {@code NOT VALID}, so it never re-checks rows already in the table — but a
     * promotion row is a NEW write and is checked immediately. So the two changes meet here, and
     * this is much cheaper to find now than at a till.
     *
     * <p>The predicate is fetched from {@code pg_constraint} rather than restated here, so this
     * test cannot drift from the migration: if someone weakens the CHECK, these assertions start
     * exercising the weakened one and the PERCENT case fails loudly. Interpolating it into the
     * query is safe — it is our own DDL coming back out of the catalogue, not input.
     */
    @Test
    void theDatabasesOwnBoundIsWhatThePromotionEngineWillMeet() {
        String def = jdbcTemplate.queryForObject(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                        + "WHERE conname = 'order_discounts_value_bounded'", String.class);
        assertThat(def)
                .as("V29's constraint is not on the table — every assertion below would be vacuous")
                .isNotNull()
                .startsWith("CHECK ");

        // The suffix is load-bearing and deliberate: NOT VALID is why this migration cannot fail
        // on creation against a database holding rows nobody has inspected. If someone later
        // validates it, that has to be a decision taken with the data in front of them, not a
        // quiet edit here — so assert it rather than merely tolerate it.
        assertThat(def)
                .as("V29 must stay NOT VALID until the pre-existing rows are repaired by hand")
                .endsWith(" NOT VALID");

        String predicate = def.substring("CHECK ".length(), def.length() - " NOT VALID".length());

        // A FLAT row carrying a paisa-sized figure is accepted: only PERCENT is capped at 100.
        // This is what a promotion labelled FLAT will look like, and V29 deliberately does not
        // refuse it — the rupees-vs-paisa unit confusion is the sibling's to fix, not a bound.
        assertThat(bound(predicate, "FLAT", "10000")).isTrue();

        // THE TRAP. A promotion labelled PERCENT while still writing paisa into `value` is
        // refused at INSERT, not clamped later. 10000 is not a percentage.
        assertThat(bound(predicate, "PERCENT", "10000"))
                .as("a PERCENT row carrying paisa must be refused by the database")
                .isFalse();

        // The boundary, inclusive — a 100% comp is a real thing and must survive.
        assertThat(bound(predicate, "PERCENT", "100")).isTrue();
        assertThat(bound(predicate, "PERCENT", "100.01")).isFalse();

        // Zero and negative are refused at both types. This is a property of the bound, and it is
        // NOT a promotion safety net — see below.
        assertThat(bound(predicate, "FLAT", "0")).isFalse();
        assertThat(bound(predicate, "PERCENT", "0")).isFalse();
        assertThat(bound(predicate, "FLAT", "-5")).isFalse();

        // WHAT THIS CONSTRAINT CANNOT SEE, recorded so that nobody reads the assertions above as
        // wider cover than they are.
        //
        // An earlier reading of this had it that a promotion against a zero-subtotal check writes
        // `value = 0` and is caught here. That was true of the code at the time and is NOT true
        // now: the promotion path was changed to carry the UNCAPPED offer in `value`, on purpose,
        // so a reader can see an offer was worth more than the check it landed on. The row that
        // reaches the table on a zero-subtotal check is therefore
        //
        //     value = 150.0000     amountPaisa = 0
        //
        // which satisfies every constraint on this table — `value > 0` happily — and still prints
        // "Automatic promotion (customer's qualifying offer) — Rs 0.00" at a guest. A false line
        // where no rule is broken and no money moves, which is a harder case than the 200% row
        // that started all this: that one at least violated something.
        //
        // Only a guard in applyPromotions can refuse it, and one exists (`capped <= 0` returns
        // before any row is built), covered by anOfferAgainstAnEmptyCheckWritesNoRowAtAll. The
        // point of writing this down is that believing the constraint covers that shape is what
        // would stop anyone looking at it.
        assertThat(bound(predicate, "FLAT", "150"))
                .as("an uncapped promotion value on a zero-subtotal check passes this bound — "
                        + "the guard in applyPromotions is what refuses it, not the database")
                .isTrue();
    }

    /** Evaluates the table's real CHECK predicate against one (type, value) pair. */
    private boolean bound(String predicate, String type, String value) {
        return Boolean.TRUE.equals(jdbcTemplate.queryForObject(
                "SELECT " + predicate + " FROM (SELECT CAST(? AS VARCHAR) AS type, "
                        + "CAST(? AS NUMERIC) AS value) s", Boolean.class, type, value));
    }

    /** The full amount, tendered, WITHOUT serving — so the check stays open and is fully paid. */
    private void payInFull(UUID orderId, long totalPaisa) {
        paymentService.recordPayment(orderId, PaymentMethod.CASH, totalPaisa, null);
    }

    @Autowired PlatformTransactionManager transactionManager;

    /**
     * Reads the persisted order back INSIDE a transaction, so {@code getDiscounts()} is a real
     * database read and not a detached proxy. Every money assertion below is made against this,
     * not against the DTO the service handed back — a service that returns the right numbers and
     * persists the wrong ones is exactly the failure this file is here to catch.
     */
    private Persisted readBack(UUID orderId) {
        return new TransactionTemplate(transactionManager).execute(status -> {
            var row = orderRepository.findById(orderId).orElseThrow();
            List<Persisted.Discount> discounts = row.getDiscounts().stream()
                    .map(d -> new Persisted.Discount(d.getScope(), d.getOrderItemId(), d.getType(),
                            d.getAmountPaisa(), d.getReason(), d.getAppliedBy()))
                    .toList();
            return new Persisted(row.getSubtotalPaisa(), row.getDiscountPaisa(), row.getTaxPaisa(),
                    row.getServiceChargePaisa(), row.getTotalPaisa(), discounts);
        });
    }

    /** What Postgres actually holds, detached — so no assertion can accidentally lazy-load. */
    private record Persisted(long subtotalPaisa, long discountPaisa, long taxPaisa,
                             long serviceChargePaisa, long totalPaisa, List<Discount> discounts) {
        record Discount(String scope, UUID orderItemId, String type, long amountPaisa,
                        String reason, UUID appliedBy) {}
    }
}
