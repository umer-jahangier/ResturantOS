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
