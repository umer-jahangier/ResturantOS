package io.restaurantos.pos;

import io.restaurantos.pos.consumer.KitchenItemStatusConsumer;
import io.restaurantos.pos.domain.enums.DerivedOrderStatus;
import io.restaurantos.pos.domain.enums.OrderItemStatus;
import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.domain.model.Order;
import io.restaurantos.pos.authz.PosAuthorizationService;
import io.restaurantos.pos.dto.*;
import io.restaurantos.pos.exception.PosExceptions;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.repository.OrderPaymentRepository;
import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.PaymentService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.authz.DefaultOpaClient;
import io.restaurantos.shared.authz.OpaClient;
import io.restaurantos.shared.authz.OpaInput;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
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
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * A cashier voiding their OWN check — decided by the REAL {@code policies/} bundle.
 *
 * <h2>Why this file was rewritten (B2)</h2>
 *
 * <p>Every test in the previous version stubbed {@code opaClient.evaluate(...)} with a canned
 * {@code OpaDecision}, so the assertions could only ever describe the {@code OpaInput} the service
 * builds. The decision itself — the thing that was broken — was supplied by the test. All three
 * cases drove {@code status == "OPEN"} and asserted {@code "OPEN"}, which is precisely the one
 * status {@code pos.rego}'s {@code void.own} rule allowed. The suite was green while a cashier
 * pressing <b>Void</b> on a check that had gone to the kitchen got
 * {@code 403 {"title":"FORBIDDEN","detail":"Not permitted: pos.void"}} in production, verified
 * again in Chromium on 2026-08-12 against {@code ORD-20260812-0175}.
 *
 * <p>The old docblock also asserted two things that were false and that cost this project hours
 * twice: that the {@code pos.void} string in the 403 was "cosmetic", and that the leading remaining
 * cause was "JWT staleness". The live token carried {@code pos.order.void.own} (14 permissions,
 * decoded from the wire), the order's {@code cashierId} was the caller's own {@code sub}, and the
 * same token voided an {@code OPEN} check seconds earlier. The cause was one line of Rego. That
 * docblock is deleted rather than corrected: a false statement in the repository is a defect of the
 * same kind as the code it excuses.
 *
 * <h2>What replaced the mock</h2>
 *
 * <p>{@link PosTestBase}'s {@code @MockitoBean OpaClient} is stubbed to DELEGATE to a real
 * {@link DefaultOpaClient} — production's own client, with production's own snake_case Jackson
 * mapper — pointed at a Testcontainers OPA server that bind-mounts this repository's real
 * {@code policies/} directory. Nothing about the decision is simulated: the rego evaluates the
 * bytes the service actually sends. The same construction is used by
 * {@code purchasing-service}'s {@code RealOpaTestConfig} (standing lesson 10-06-A: a test that
 * mocks the thing that broke proves nothing).
 *
 * <p>Consequence worth stating plainly: this file now fails if {@code pos.rego} changes underneath
 * it, which is the entire point. {@link #cashierVoidsOwnCheckAfterItHasGoneToTheKitchen} fails with
 * a {@code PermissionDeniedException} against the old one-word rule.
 */
class VoidOwnOrderIT extends PosTestBase {

    /**
     * Real OPA, real bundle. Started once per JVM alongside {@link PosTestBase}'s Postgres.
     *
     * <p>The bundle is <b>copied</b> into the container, not bind-mounted. A bind mount only works
     * when the host path happens to be inside the Docker VM's shared directories, and when it is
     * not, the mount silently resolves to an EMPTY {@code /policies}: OPA starts, answers
     * {@code /health} 200, and returns {@code {}} for every query — which {@link DefaultOpaClient}
     * reads, correctly, as deny. That failure mode is invisible in exactly the wrong direction. It
     * makes every allow-case fail and every deny-case pass, so a suite of deny assertions would go
     * green against a policy engine holding no policy at all. Encountered while writing this file
     * (worktree under {@code /private/tmp}, Colima sharing only {@code /Users}); see
     * {@link #assertPolicyBundleIsActuallyLoaded()} for the guard that would now catch it.
     */
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

    private static String opaBaseUrl() {
        return "http://" + OPA.getHost() + ":" + OPA.getMappedPort(8181);
    }

    /**
     * Positive control. An OPA with no bundle denies everything and looks healthy doing it, so
     * before any assertion is trusted, prove the engine holds {@code restaurantos.pos} and says
     * YES to an input it must allow. Runs as its own test so its failure names the harness rather
     * than being blamed on the policy.
     */
    @Test
    void assertPolicyBundleIsActuallyLoaded() {
        String modules = RestClient.builder().baseUrl(opaBaseUrl())
                .requestFactory(new JdkClientHttpRequestFactory()).build()
                .get().uri("/v1/policies").retrieve().body(String.class);
        assertThat(modules)
                .as("OPA is serving no policy module — the bundle never reached the container, and "
                        + "every decision below would be a meaningless deny")
                .contains("restaurantos/pos.rego");

        // ...and it decides, rather than merely holding text: a manager voiding in their own
        // tenant and branch is allowed by void.any, a rule this file does not otherwise touch.
        // SENT_TO_KDS, not "SERVED": void.any reads no status at all, but a status literal that
        // production cannot produce has no place in a positive control — that confusion is what
        // this file's B2 re-open was about.
        assertThat(opaClient.evaluate("pos", OpaInput.builder()
                .user(new OpaInput.User(cashierId, tenantId, branchId,
                        List.of("pos.order.void.any"), Map.of()))
                .resource(new OpaInput.Resource("order", UUID.randomUUID(), tenantId, branchId,
                        cashierId, "SENT_TO_KDS", null, 0L, true))
                .action("void")
                .build()).allow())
                .as("real OPA must ALLOW void.any for an in-tenant, in-branch manager")
                .isTrue();
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

    @Autowired OrderService orderService;
    @Autowired PaymentService paymentService;
    @Autowired PosAuthorizationService posAuthorizationService;
    @Autowired OutboxRepository outboxRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired OrderPaymentRepository orderPaymentRepository;
    @Autowired OrderRepository orderRepository;
    @Autowired TenantContext tenantContext;
    /** The bean the {@code kitchen.item.status} RabbitMQ listener delegates to — the real seam. */
    @Autowired KitchenItemStatusConsumer kitchenItemStatusConsumer;

    UUID tenantId;
    UUID branchId;
    UUID cashierId;
    UUID menuItemId;

    @BeforeEach
    void setUp() {
        outboxRepository.deleteAll();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        cashierId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, cashierId, null);

        // The mock is a pass-through to the real policy bundle, never a canned answer.
        OpaClient live = new DefaultOpaClient(RestClient.builder()
                .baseUrl(opaBaseUrl())
                .requestFactory(new JdkClientHttpRequestFactory())
                .build());
        when(opaClient.evaluate(any(), any()))
                .thenAnswer(call -> live.evaluate(call.getArgument(0), call.getArgument(1)));

        // Cash tenders need an open Finance period.
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
        item.setName("Nihari");
        item.setBasePricePaisa(45000L);
        item.setTaxRatePct(new BigDecimal("0.00"));
        item = menuItemRepository.save(item);
        menuItemId = item.getId();

        setSecurityContext(cashierId, branchId, List.of("pos.order.void.own"), Map.of());

        // Financial-integrity guard: the own-branch void tests create the cashier's order
        // first, which now requires an OPEN till for that cashier. (The cross-branch test
        // creates in a different branch and is denied earlier by the branch-isolation guard.)
        openTillForCashier(branchId);
    }

    private void setSecurityContext(UUID userId, UUID userBranchId, List<String> permissions,
                                     Map<String, Object> attributes) {
        JwtClaims claims = new JwtClaims(
                userId, tenantId, userBranchId,
                List.of("CASHIER"), permissions, attributes, null);
        UsernamePasswordAuthenticationToken auth =
                new UsernamePasswordAuthenticationToken(claims, null, List.of());
        SecurityContextHolder.getContext().setAuthentication(auth);
    }

    private OrderDto createOpenOrderInBranch(UUID orderBranchId) {
        UUID clientOrderId = UUID.randomUUID();
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(orderBranchId, clientOrderId, null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, orderBranchId, 1, null, null));
        return orderService.getOrder(order.id(), orderBranchId);
    }

    /** The same check, fired at the kitchen — the state a restaurant actually voids in. */
    private OrderDto createFiredOrderInBranch(UUID orderBranchId) {
        OrderDto order = createOpenOrderInBranch(orderBranchId);
        orderService.sendToKds(order.id(), null);
        OrderDto fired = orderService.getOrder(order.id(), orderBranchId);
        assertThat(fired.status()).isEqualTo(OrderStatus.SENT_TO_KDS);
        return fired;
    }

    // ── (1) THE DEFECT: the cashier's own check, already at the pass, unpaid ───────────────

    /**
     * The guest walked out after the order went to the kitchen. Nothing has been paid. The cashier
     * who rang it writes it off with a reason, alone, and the drawer stays closeable.
     *
     * <p><b>Falsification.</b> Restore {@code input.resource.status == "OPEN"} in
     * {@code pos.rego}'s {@code void.own} rule and this fails on the {@code voidOrder} call with
     * {@code PermissionDeniedException: Not permitted: pos.void} — the production 403, reproduced
     * inside the build. Verified by running it against the reverted policy before the fix landed.
     */
    @Test
    void cashierVoidsOwnCheckAfterItHasGoneToTheKitchen() {
        OrderDto fired = createFiredOrderInBranch(branchId);

        OrderDto voided = orderService.voidOrder(
                fired.id(), new VoidOrderRequest("Guest left before the food went out"),
                UUID.randomUUID().toString());

        assertThat(voided.status()).isEqualTo(OrderStatus.VOIDED);

        // Read back from Postgres, not from the returned DTO: the reason and the actor are what
        // the Voided filter shows the next person to look at this check.
        var row = orderRepository.findById(fired.id()).orElseThrow();
        assertThat(row.getStatus()).isEqualTo(OrderStatus.VOIDED);
        assertThat(row.getVoidReason()).isEqualTo("Guest left before the food went out");
        assertThat(row.getVoidedBy()).isEqualTo(cashierId);
        assertThat(row.getVoidedAt()).isNotNull();

        assertThat(outboxRepository.findAll().stream()
                .filter(e -> "ORDER_VOIDED".equals(e.getEventType()))
                .count()).isEqualTo(1);

        // And the status the real policy said yes to was the fired one, not OPEN.
        ArgumentCaptor<OpaInput> captor = ArgumentCaptor.forClass(OpaInput.class);
        verify(opaClient).evaluate(eq("pos"), captor.capture());
        OpaInput sent = captor.getValue();
        assertThat(sent.resource().status()).isEqualTo("SENT_TO_KDS");
        assertThat(sent.resource().createdBy()).isEqualTo(cashierId);
        assertThat(sent.resource().amountPaidPaisa()).isZero();
        assertThat(sent.user().permissions()).contains("pos.order.void.own");
    }

    // ── (2) a check with money on it is refused for MONEY, not for permission ─────────────

    /**
     * The cashier has taken cash. Void must refuse — and refuse with the message that names the
     * operation which does work, not a permission error the operator can do nothing about. The
     * tender itself must survive the attempt untouched.
     */
    @Test
    void cashierVoidOnOwnPaidCheckIsRefusedForMoneyAndTheTenderSurvives() {
        OrderDto fired = createFiredOrderInBranch(branchId);
        long total = orderService.getOrder(fired.id(), branchId).totalPaisa();
        paymentService.recordPayment(fired.id(), PaymentMethod.CASH, total, null);

        assertThatThrownBy(() -> orderService.voidOrder(
                fired.id(), new VoidOrderRequest("Guest left"), UUID.randomUUID().toString()))
                .isInstanceOf(PosExceptions.OrderHasPaymentsException.class)
                .isNotInstanceOf(PermissionDeniedException.class);

        // The payment row is exactly as it was, and the order is still live and settleable.
        var payments = orderPaymentRepository.findByOrderId(fired.id());
        assertThat(payments).hasSize(1);
        assertThat(payments.get(0).getAmountPaisa()).isEqualTo(total);
        assertThat(orderPaymentRepository.sumAmountByOrderId(fired.id())).isEqualTo(total);
        assertThat(orderRepository.findById(fired.id()).orElseThrow().getStatus())
                .isNotEqualTo(OrderStatus.VOIDED);

        assertThat(outboxRepository.findAll().stream()
                .filter(e -> "ORDER_VOIDED".equals(e.getEventType()))
                .count()).isZero();
    }

    /**
     * ...and the POLICY refuses it too, independently of the service guard.
     *
     * <p>{@code voidOrder} throws {@code ORDER_HAS_PAYMENTS} before it ever reaches OPA, so the
     * money clause in {@code void.own} would be unreachable from that path and could rot into a
     * decoration — structurally present, behaviourally absent, the failure mode this repository is
     * named for. This drives {@link PosAuthorizationService#authorizeVoid} directly, which is a
     * real call site with a second caller ({@code authorization-service} exposes the same
     * {@code (pos, void)} pair over HTTP), and pins the clause as a live control.
     */
    @Test
    void thePolicyItselfRefusesAVoidOnceMoneyIsOnTheCheck() {
        UUID orderId = UUID.randomUUID();

        assertThatThrownBy(() -> posAuthorizationService.authorizeVoid(
                orderId, tenantId, branchId, cashierId, "SENT_TO_KDS", 168260L, false))
                .isInstanceOf(PermissionDeniedException.class);

        // One paisa is money. There is no threshold below which a void becomes acceptable.
        assertThatThrownBy(() -> posAuthorizationService.authorizeVoid(
                orderId, tenantId, branchId, cashierId, "OPEN", 1L, false))
                .isInstanceOf(PermissionDeniedException.class);

        // Control: the identical call with nothing tendered is allowed, so the two refusals above
        // are attributable to the money and not to some other clause failing.
        posAuthorizationService.authorizeVoid(
                orderId, tenantId, branchId, cashierId, "SENT_TO_KDS", 0L, false);
    }

    /**
     * ...and the PASS clause is a live control at the same seam, for the same reason the money
     * clause needed one.
     *
     * <p>{@link #cashierCannotVoidTheirOwnCheckOnceTheKitchenHasPlatedIt} proves the boundary
     * end-to-end through {@code voidOrder}, which is the test that matters. This one pins the
     * clause at {@link PosAuthorizationService#authorizeVoid} directly, because that method has a
     * second caller: {@code authorization-service} exposes the same {@code (pos, void)} pair over
     * HTTP. The two refusals differ only in {@code anyLinePlated}, so neither can be explained by
     * another clause failing.
     */
    @Test
    void thePolicyItselfRefusesAVoidOnceTheKitchenHasPlated() {
        UUID orderId = UUID.randomUUID();

        assertThatThrownBy(() -> posAuthorizationService.authorizeVoid(
                orderId, tenantId, branchId, cashierId, "SENT_TO_KDS", 0L, true))
                .as("void.own must refuse a plated check even with no tender on it")
                .isInstanceOf(PermissionDeniedException.class);

        // Control: same call, nothing plated — allowed.
        posAuthorizationService.authorizeVoid(
                orderId, tenantId, branchId, cashierId, "SENT_TO_KDS", 0L, false);
    }

    // ── (3) the boundary on the other side: once food is plated it is a manager's call ────

    /**
     * The widening stops at the pass: once the kitchen has plated something, writing it off is
     * {@code void.any}'s business.
     *
     * <h3>Why this test was rewritten (B2 re-open)</h3>
     *
     * <p>The previous version called {@code authorizeVoid} directly with the hand-written strings
     * {@code "PARTIAL_READY", "READY", "SERVED", "CLOSED"} and asserted each was refused. It passed
     * green for three weeks while the boundary it claimed to guard did not exist, because
     * <b>{@code order.status} never holds any of those first three values</b>. Six
     * {@code setStatus(OrderStatus.…)} call sites exist in {@code pos-service} and they write
     * DRAFT, OPEN, SENT_TO_KDS, CLOSED, VOIDED and REFUNDED — nothing else.
     * {@code setStatus(SERVED)} and {@code setStatus(PARTIAL_READY)} have never existed in this
     * repository's history; {@code setStatus(READY)} lived eleven days and was deleted on purpose
     * in {@code fc6f389f} ("no more order-level hand-set"), which moved kitchen progress to
     * per-item statuses and the computed {@code derivedStatus}.
     *
     * <p>So the old test fed the policy four statuses, three of which production cannot produce,
     * and read the resulting denials as proof of a live control. Its own docblock claimed "if this
     * ever starts passing, void.own has been loosened" — but it could not fail for the reason that
     * mattered, which was that the branch was unreachable and a cashier could in fact void a
     * cooked, served, unpaid check. Measured live on 2026-08-12: {@code ORD-20260812-0340},
     * serve-all returned 200 with {@code derivedStatus: "SERVED"} and {@code status} still
     * {@code SENT_TO_KDS}, and the cashier's own void then returned 200.
     *
     * <p>A test that asserts a denial the system can never be asked for is not a guard. This drives
     * a REAL order to the pass through the seam a cook's bump actually lands on
     * ({@link KitchenItemStatusConsumer#applyItemStatus}, which is what the
     * {@code kitchen.item.status} listener calls after deserialising) and then asks the real
     * service to void it.
     *
     * <p><b>Falsification.</b> Revert the {@code any_line_plated} clause in {@code pos.rego}'s
     * {@code void.own} and this fails on the {@code voidOrder} call — the void SUCCEEDS and no
     * exception is thrown. Verified by running it against the unfixed policy before the fix landed.
     */
    @Test
    void cashierCannotVoidTheirOwnCheckOnceTheKitchenHasPlatedIt() {
        OrderDto fired = createFiredOrderInBranch(branchId);
        UUID lineId = fired.items().get(0).id();

        // The cook bumps the ticket to Ready. This is the production seam, not a repository poke.
        kitchenItemStatusConsumer.applyItemStatus(fired.id(), lineId, "READY");

        // Pin the thing the old test assumed away: the persisted status does NOT move. If someone
        // later re-introduces an order-level hand-set, this fails and points at fc6f389f's
        // decision rather than letting two writers race on one column.
        // Line status via the DTO, not the entity: Order.items is lazy and this assertion runs
        // outside any session.
        assertThat(orderService.getOrder(fired.id(), branchId).items().get(0).kdsStatus())
                .as("the cook's bump must reach the line")
                .isEqualTo(OrderItemStatus.READY);

        Order plated = orderRepository.findById(fired.id()).orElseThrow();
        assertThat(plated.getStatus())
                .as("order.status records only 'has been fired', never kitchen progress")
                .isEqualTo(OrderStatus.SENT_TO_KDS);
        assertThat(plated.getDerivedStatus())
                .as("derive() collapses READY into IN_PROGRESS — which is exactly why the policy "
                        + "cannot find the pass from derivedStatus alone")
                .isEqualTo(DerivedOrderStatus.IN_PROGRESS);

        // Food exists in the world. The cashier who rang it may no longer write it off alone.
        assertThatThrownBy(() -> orderService.voidOrder(
                fired.id(), new VoidOrderRequest("Guest walked out"), UUID.randomUUID().toString()))
                .as("void.own must not reach a check with a plated line")
                .isInstanceOf(PermissionDeniedException.class);

        assertThat(orderRepository.findById(fired.id()).orElseThrow().getStatus())
                .isNotEqualTo(OrderStatus.VOIDED);
        assertThat(outboxRepository.findAll().stream()
                .filter(e -> "ORDER_VOIDED".equals(e.getEventType()))
                .count()).isZero();
    }

    /**
     * The same boundary at the far end of the service: every line served, nothing paid. This is
     * the exact state {@code ORD-20260812-0340} was in when the cashier's own void returned 200 —
     * {@code serve-all} had answered 200 with {@code derivedStatus: "SERVED"} while {@code status}
     * sat at {@code SENT_TO_KDS}.
     */
    @Test
    void cashierCannotVoidTheirOwnCheckOnceItHasBeenServed() {
        OrderDto fired = createFiredOrderInBranch(branchId);
        orderService.markAllItemsServed(fired.id());

        Order served = orderRepository.findById(fired.id()).orElseThrow();
        assertThat(served.getDerivedStatus()).isEqualTo(DerivedOrderStatus.SERVED);
        assertThat(served.getStatus())
                .as("serve-all moves derivedStatus, never status — the defect's whole mechanism")
                .isEqualTo(OrderStatus.SENT_TO_KDS);

        assertThatThrownBy(() -> orderService.voidOrder(
                fired.id(), new VoidOrderRequest("Guest walked out"), UUID.randomUUID().toString()))
                .as("void.own must not reach a served check")
                .isInstanceOf(PermissionDeniedException.class);

        assertThat(orderRepository.findById(fired.id()).orElseThrow().getStatus())
                .isNotEqualTo(OrderStatus.VOIDED);
    }

    /**
     * ...and a manager still can, in the same state. Without this, the two refusals above would be
     * satisfied by a policy that simply denied every void, and the widening B2 exists to deliver
     * would be silently undone.
     */
    @Test
    void managerCanStillVoidAPlatedCheckViaVoidAny() {
        OrderDto fired = createFiredOrderInBranch(branchId);
        kitchenItemStatusConsumer.applyItemStatus(fired.id(), fired.items().get(0).id(), "READY");

        setSecurityContext(cashierId, branchId, List.of("pos.order.void.any"), Map.of());

        OrderDto voided = orderService.voidOrder(
                fired.id(), new VoidOrderRequest("Comped — kitchen error"),
                UUID.randomUUID().toString());
        assertThat(voided.status()).isEqualTo(OrderStatus.VOIDED);
    }

    // ── (4) the never-fired states still work ────────────────────────────────────────────

    @Test
    void cashierVoidsOwnOpenOrder() {
        OrderDto order = createOpenOrderInBranch(branchId);

        OrderDto voided = orderService.voidOrder(
                order.id(), new VoidOrderRequest("Customer changed mind"), UUID.randomUUID().toString());
        assertThat(voided.status()).isEqualTo(OrderStatus.VOIDED);

        ArgumentCaptor<OpaInput> captor = ArgumentCaptor.forClass(OpaInput.class);
        verify(opaClient).evaluate(eq("pos"), captor.capture());
        OpaInput sentInput = captor.getValue();
        assertThat(sentInput.resource().createdBy()).isEqualTo(cashierId);
        assertThat(sentInput.resource().status()).isEqualTo("OPEN");
        assertThat(sentInput.resource().branchId()).isEqualTo(branchId);
        assertThat(sentInput.resource().tenantId()).isEqualTo(tenantId);
        assertThat(sentInput.user().id()).isEqualTo(cashierId);
        assertThat(sentInput.user().branchId()).isEqualTo(branchId);
        assertThat(sentInput.user().permissions()).contains("pos.order.void.own");

        assertThat(outboxRepository.findAll().stream()
                .filter(e -> "ORDER_VOIDED".equals(e.getEventType()))
                .count()).isEqualTo(1);
    }

    /**
     * A DRAFT is a check with no order number and no lines — {@code createOrder} before the first
     * {@code addItem}. Order Management renders a <b>Cancel</b> control on those rows, and that
     * control posts to this same void endpoint, so a policy that stopped at OPEN broke it for the
     * only persona that creates drafts. Five such rows were stranded on the seeded drawer.
     */
    @Test
    void cashierCancelsTheirOwnDraft() {
        OrderDto draft = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        assertThat(orderRepository.findById(draft.id()).orElseThrow().getStatus())
                .isEqualTo(OrderStatus.DRAFT);

        OrderDto voided = orderService.voidOrder(
                draft.id(), new VoidOrderRequest("Draft cancelled"), UUID.randomUUID().toString());
        assertThat(voided.status()).isEqualTo(OrderStatus.VOIDED);
    }

    // ── (5) isolation and the missing-permission control, both against the real policy ────

    @Test
    void cashierOwnOrderInAnotherBranchIsDenied() {
        // Order created in a DIFFERENT branch than the cashier's current JWT branch. createOrder
        // enforces requireOwnBranch, so the order has to be created while the security context IS
        // that branch; the mismatch under test is at VOID time, not at create time.
        UUID otherBranchId = UUID.randomUUID();
        UUID jwtBranchBefore = branchId;
        setSecurityContext(cashierId, otherBranchId, List.of("pos.order.void.own"), Map.of());
        tenantContext.set(tenantId, otherBranchId, cashierId, null);
        OrderDto order = createOpenOrderInBranch(otherBranchId);

        setSecurityContext(cashierId, jwtBranchBefore, List.of("pos.order.void.own"), Map.of());
        tenantContext.set(tenantId, jwtBranchBefore, cashierId, null);

        // No stubbed decision: common.same_branch in the real bundle is what refuses this.
        assertThatThrownBy(() ->
                orderService.voidOrder(order.id(), new VoidOrderRequest("Test"), UUID.randomUUID().toString()))
                .isInstanceOf(PermissionDeniedException.class);

        ArgumentCaptor<OpaInput> captor = ArgumentCaptor.forClass(OpaInput.class);
        verify(opaClient).evaluate(eq("pos"), captor.capture());
        OpaInput sentInput = captor.getValue();
        assertThat(sentInput.resource().branchId()).isEqualTo(otherBranchId);
        assertThat(sentInput.user().branchId()).isEqualTo(branchId);

        assertThat(outboxRepository.findAll().stream()
                .filter(e -> "ORDER_VOIDED".equals(e.getEventType()))
                .count()).isZero();
    }

    /**
     * A caller holding none of the void permissions is refused. Kept from the original suite
     * because the control is real — but note what it is NOT: it is not evidence for the
     * "stale JWT" story the old docblock told. The live cashier's token carried
     * {@code pos.order.void.own} and was refused anyway, which is what this file now proves in
     * {@link #cashierVoidsOwnCheckAfterItHasGoneToTheKitchen}.
     */
    @Test
    void callerWithoutAnyVoidPermissionIsDenied() {
        setSecurityContext(cashierId, branchId, List.of(), Map.of());
        OrderDto order = createOpenOrderInBranch(branchId);
        setSecurityContext(cashierId, branchId, List.of(), Map.of());

        assertThatThrownBy(() ->
                orderService.voidOrder(order.id(), new VoidOrderRequest("Test"), UUID.randomUUID().toString()))
                .isInstanceOf(PermissionDeniedException.class);

        ArgumentCaptor<OpaInput> captor = ArgumentCaptor.forClass(OpaInput.class);
        verify(opaClient).evaluate(eq("pos"), captor.capture());
        assertThat(captor.getValue().user().permissions()).doesNotContain("pos.order.void.own");
    }
}
