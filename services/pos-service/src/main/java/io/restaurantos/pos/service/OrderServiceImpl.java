package io.restaurantos.pos.service;

import io.restaurantos.pos.authz.PosAuthorizationService;
import io.restaurantos.pos.domain.enums.DerivedOrderStatus;
import io.restaurantos.pos.domain.enums.OrderItemStatus;
import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.OrderType;
import io.restaurantos.pos.domain.enums.PaymentStatus;
import io.restaurantos.pos.domain.enums.TillStatus;
import io.restaurantos.pos.domain.model.*;
import io.restaurantos.pos.dto.*;
import io.restaurantos.shared.event.payload.PosEventContract;
import io.restaurantos.pos.event.PosEventPayloads;
import io.restaurantos.pos.event.PosVoidRefundPayloads;
import io.restaurantos.pos.exception.PosExceptions;
import io.restaurantos.pos.feign.CrmCustomerSearchClient;
import io.restaurantos.pos.feign.CrmPromotionClient;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.repository.*;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.exception.PeriodLockedException;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.idempotency.IdempotencyService;
import io.restaurantos.shared.tenant.TenantContext;
import io.restaurantos.pos.support.BranchBusinessDay;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.Collectors;

@Service
@Transactional
public class OrderServiceImpl implements OrderService {

    private static final String POS_EXCHANGE = "pos.topic";
    private static final String ORDER_CREATED_KEY = "pos.order.created";
    private static final String ORDER_CREATED_TYPE = "ORDER_CREATED";
    private static final String ORDER_SENT_TO_KDS_KEY = "pos.order.sent_to_kds";
    private static final String ORDER_SENT_TO_KDS_TYPE = "ORDER_SENT_TO_KDS";
    private static final String ORDER_CLOSED_KEY = "pos.order.closed";
    private static final String ORDER_CLOSED_TYPE = "ORDER_CLOSED";
    private static final String ORDER_VOIDED_KEY = "pos.order.voided";
    private static final String ORDER_VOIDED_TYPE = "ORDER_VOIDED";
    private static final String ORDER_ITEM_CANCELLED_KEY = "pos.order.item_cancelled";
    private static final String ORDER_ITEM_CANCELLED_TYPE = "ORDER_ITEM_CANCELLED";
    private static final String ORDER_ITEM_SERVED_KEY = "pos.order.item_served";
    private static final String ORDER_ITEM_SERVED_TYPE = "ORDER_ITEM_SERVED";
    private static final String DEFAULT_KDS_STATION = "DEFAULT";
    private static final String VIEW_ALL_PERMISSION = "pos.order.view.all";
    /**
     * Cap on the customer ids a single Order Management search may resolve (S0-05). The ids
     * become an {@code IN (…)} predicate, so an uncapped resolve would let a one-character term
     * build a predicate the width of the tenant's customer book.
     */
    private static final int CUSTOMER_MATCH_LIMIT = 50;

    private static final org.slf4j.Logger log =
            org.slf4j.LoggerFactory.getLogger(OrderServiceImpl.class);
    /**
     * Marks an ORDER-scoped discount as machine-applied by the CRM promotion engine, so re-running
     * the evaluation replaces it instead of stacking. {@code OrderDiscount} has no reason column;
     * the type discriminator carries the provenance, alongside the manual FLAT/PERCENT values.
     */
    private static final String PROMOTION_DISCOUNT_TYPE = "PROMOTION";

    private final OrderRepository orderRepository;
    private final OrderSequenceRepository sequenceRepository;
    private final MenuItemRepository menuItemRepository;
    private final StationRepository stationRepository;
    /** The ONE place that decides where a menu item goes at a branch (28-05). */
    private final StationRoutingResolver stationRoutingResolver;
    private final TaxClassResolver taxClassResolver;
    /** The ONE place a client-supplied modifier id becomes a named, priced line row (S6). */
    private final ModifierSelectionResolver modifierSelectionResolver;
    private final BranchMenuOverrideRepository overrideRepository;
    private final DiningTableRepository tableRepository;
    private final OrderPaymentRepository orderPaymentRepository;
    private final OrderPricingCalculator pricingCalculator;
    private final OrderStateMachine stateMachine;
    private final CrmPromotionClient crmPromotionClient;
    /** S0-05: resolves a search term to customer ids; crm-service owns phones and names. */
    private final CrmCustomerSearchClient crmCustomerSearchClient;
    private final TenantContext tenantContext;
    private final EventPublisher eventPublisher;
    private final IdempotencyService idempotencyService;
    private final SplitTenderCalculator splitTenderCalculator;
    private final FinancePeriodClient financePeriodClient;
    private final PosAuthorizationService posAuthorizationService;
    private final TillSessionRepository tillSessionRepository;
    private final OrderStatusDerivationService orderStatusDerivationService;
    private final PaymentStatusDerivationService paymentStatusDerivationService;
    private final TableService tableService;
    private final OrderMapper orderMapper;
    /** 26-07. Reached ONLY through its two after-commit registration methods. */
    private final PrintDispatchService printDispatchService;
    /** The ONE answer to "which trading day is this?" in this service (S0-C). */
    private final BranchBusinessDay branchBusinessDay;
    /**
     * B3: snapshots WHO applied a discount, as a name. Fail-soft by construction — it returns
     * null rather than throwing, so an auth-service outage costs the report a name and never
     * costs a guest their discount.
     */
    private final StaffNameDirectory staffNameDirectory;
    /**
     * F20: the branch's service-charge policy, read on the PRICING path. Its
     * {@code policyFor} is the only method used here and it performs no authorization check —
     * a cashier holds none of the settings permissions and must still get the right total.
     */
    private final ServiceChargeService serviceChargeService;

    public OrderServiceImpl(OrderRepository orderRepository,
                            OrderSequenceRepository sequenceRepository,
                            MenuItemRepository menuItemRepository,
                            StationRepository stationRepository,
                            BranchMenuOverrideRepository overrideRepository,
                            DiningTableRepository tableRepository,
                            OrderPaymentRepository orderPaymentRepository,
                            OrderPricingCalculator pricingCalculator,
                            OrderStateMachine stateMachine,
                            CrmPromotionClient crmPromotionClient,
                            CrmCustomerSearchClient crmCustomerSearchClient,
                            TenantContext tenantContext,
                            EventPublisher eventPublisher,
                            IdempotencyService idempotencyService,
                            SplitTenderCalculator splitTenderCalculator,
                            FinancePeriodClient financePeriodClient,
                            PosAuthorizationService posAuthorizationService,
                            TillSessionRepository tillSessionRepository,
                            OrderStatusDerivationService orderStatusDerivationService,
                            PaymentStatusDerivationService paymentStatusDerivationService,
                            TableService tableService,
                            OrderMapper orderMapper,
                            StationRoutingResolver stationRoutingResolver,
                            TaxClassResolver taxClassResolver,
                            ModifierSelectionResolver modifierSelectionResolver,
                            // @Lazy cuts a real cycle, at the ONE edge this plan adds:
                            //   OrderServiceImpl -> PrintDispatchService -> PrintJobServiceImpl
                            //     -> ReceiptDocumentAssembler -> OrderService
                            // The assembler's dependency on OrderService is 26-03's and is on the
                            // receipt READ path; narrowing it would mean reworking a shipped plan
                            // to accommodate this one. A proxy here is honest instead: this
                            // reference is dereferenced only AFTER a transaction commits, never
                            // during context startup, so the laziness costs nothing and the
                            // constraint it encodes ("printing depends on orders, not the other
                            // way round") is the right one.
                            @org.springframework.context.annotation.Lazy
                            PrintDispatchService printDispatchService,
                            BranchBusinessDay branchBusinessDay,
                            StaffNameDirectory staffNameDirectory,
                            ServiceChargeService serviceChargeService) {
        this.serviceChargeService = serviceChargeService;
        this.orderRepository = orderRepository;
        this.sequenceRepository = sequenceRepository;
        this.menuItemRepository = menuItemRepository;
        this.stationRepository = stationRepository;
        this.overrideRepository = overrideRepository;
        this.tableRepository = tableRepository;
        this.orderPaymentRepository = orderPaymentRepository;
        this.pricingCalculator = pricingCalculator;
        this.stateMachine = stateMachine;
        this.crmPromotionClient = crmPromotionClient;
        this.crmCustomerSearchClient = crmCustomerSearchClient;
        this.tenantContext = tenantContext;
        this.eventPublisher = eventPublisher;
        this.idempotencyService = idempotencyService;
        this.splitTenderCalculator = splitTenderCalculator;
        this.financePeriodClient = financePeriodClient;
        this.posAuthorizationService = posAuthorizationService;
        this.tillSessionRepository = tillSessionRepository;
        this.orderStatusDerivationService = orderStatusDerivationService;
        this.paymentStatusDerivationService = paymentStatusDerivationService;
        this.tableService = tableService;
        this.orderMapper = orderMapper;
        this.stationRoutingResolver = stationRoutingResolver;
        this.taxClassResolver = taxClassResolver;
        this.modifierSelectionResolver = modifierSelectionResolver;
        this.printDispatchService = printDispatchService;
        this.branchBusinessDay = branchBusinessDay;
        this.staffNameDirectory = staffNameDirectory;
    }

    // tableRepository is retained solely for listOrderSummaries' table-name lookup
    // (findByBranchId) — all table STATUS mutation now routes exclusively through
    // TableService.syncStatusForOrder (single derivation seam, RESEARCH.md Pitfall 5).

    @Override
    public OrderDto createOrder(CreateOrderRequest request) {
        // SECURITY (branch isolation): the request-supplied branchId must never widen scope
        // beyond the caller's verified JWT branch — otherwise a cashier scoped to branch A
        // could create an order under sibling branch B (RLS is tenant-only and would not
        // block it). Validated before the idempotency lookup so a cross-branch attempt is
        // rejected outright rather than replaying an existing order.
        requireOwnBranch(request.branchId());

        // Resolved before the idempotency lookup because that lookup is tenant-scoped.
        UUID tenantId = tenantContext.requireTenantId();

        // Idempotent on (tenant, clientOrderId) — NOT on clientOrderId alone. The client
        // supplies clientOrderId, so a tenant-blind lookup here let a caller replay another
        // tenant's order back to itself. See OrderRepository#findByTenantIdAndClientOrderId.
        Optional<Order> existing =
                orderRepository.findByTenantIdAndClientOrderId(tenantId, request.clientOrderId());
        if (existing.isPresent()) {
            return orderMapper.toDto(existing.get());
        }

        Order order = new Order();
        order.setTenantId(tenantId);
        order.setBranchId(request.branchId());
        order.setClientOrderId(request.clientOrderId());
        order.setType(request.type() != null ? request.type() : OrderType.DINE_IN);
        order.setStatus(OrderStatus.DRAFT);
        order.setCoverCount(Math.max(1, request.coverCount()));
        order.setCustomerId(request.customerId());
        order.setNotes(request.notes());

        if (request.tableId() != null) {
            // SECURITY / correctness (19b-01): this used to be a bare `order.setTableId(...)` with
            // no lookup at all. It was unreachable in practice only because no tenant had any
            // dining tables — the create path accepted ANY uuid, including a sibling branch's
            // table or one that never existed, and the order would then carry a table id that
            // resolves to nothing on every screen that tries to name it.
            //
            // Now the same rules the assign-table path already enforced apply at creation:
            // the table must exist inside the caller's tenant AND branch, and must still be in
            // service. Status is deliberately NOT checked here — createOrder immediately routes
            // the binding through syncStatusForOrder, which is what flips the table to OCCUPIED;
            // requiring AVAILABLE first would make two waiters racing the same table fail in a
            // way the existing single-seam design already handles.
            DiningTable table = tableRepository
                    .findByIdTenantAndBranch(request.tableId(), tenantId, request.branchId())
                    .orElseThrow(() -> new ResourceNotFoundException(
                            "Dining table not found: " + request.tableId()));
            if (!table.isActive()) {
                throw new io.restaurantos.shared.exception.StateInvalidException(
                        "Table is no longer in service: " + table.getTableNumber());
            }
            order.setTableId(table.getId());
        }

        // TILL BINDING IS OPPORTUNISTIC HERE — THE REQUIREMENT LIVES AT CASH SETTLEMENT (D-30).
        // If the creating user already has an OPEN till, bind it now: a cashier who opens the
        // drawer before taking orders gets exactly the behaviour they had before, and the
        // reconciliation link exists from the first moment it can. If they have none, the order
        // is persisted with tillSessionId = null and it is PaymentServiceImpl.recordPayment that
        // refuses to take CASH against it — see that method for the enforcement.
        //
        // This method used to hard-require the creator's OPEN till, on a financial-integrity
        // rationale that did not survive contact with two facts:
        //   1. It made the WAITER role unusable. In table service the waiter takes the order and
        //      a cashier settles it, so a waiter cannot hold a till by design — yet 13-02's
        //      correctly-granted waiter was refused here with 409 NO_OPEN_TILL.
        //   2. It never established the invariant it claimed. The guard only fired when a userId
        //      was present, so every path without one already created orders with a null till.
        // Moving the rule to the point where cash actually changes hands makes it stronger, not
        // weaker: a CASH tender with no open till is accepted TODAY and leaves the order unlinked
        // (invisible to TillServiceImpl.closeTill's expected-closing sum), and after this change
        // it is not. Pinned by WaiterOrderNoTillIT and CashPaymentRequiresTillIT.
        //
        // Making this a per-POS-profile setting (a combined counter vs. a separate food POS and
        // bar) is Phase 16 work; this is the default those profiles will vary from.
        //
        // Only the creating user's own till is ever considered — an order must never be silently
        // attributed to a drawer belonging to someone else.
        Optional<UUID> cashierId = tenantContext.getUserId();
        if (cashierId.isPresent()) {
            UUID uid = cashierId.get();
            order.setCashierId(uid);
            // Not .ifPresent(order::setTillSessionId): `order` is reassigned by the save() below,
            // so it is not effectively final and cannot be captured by a lambda here.
            Optional<TillSession> openTill = tillSessionRepository
                    .findByCashierIdAndStatus(uid, TillStatus.OPEN);
            if (openTill.isPresent()) {
                order.setTillSessionId(openTill.get().getId());
            }
        }

        order = orderRepository.save(order);
        return orderMapper.toDto(order);
    }

    @Override
    public OrderDto addItem(UUID orderId, AddOrderItemRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        Order order = findOrderForTenant(orderId, tenantId);

        // Allow adding items to any non-terminal (settlement) order status — mirrors the
        // sendToKds guard symmetrically (RESEARCH.md Pitfall 6): items can be added on any
        // order not yet CLOSED/VOIDED/REFUNDED, including SENT_TO_KDS/PARTIAL_READY/READY,
        // so a subsequent sendToKds() revision fire is never a dead end.
        if (isTerminal(order.getStatus())) {
            throw new io.restaurantos.shared.exception.StateInvalidException(
                    "Cannot add items to order in status: " + order.getStatus());
        }

        // SECURITY (tenant isolation): menuItemId is client-supplied, so it is resolved with an
        // explicitly tenant-scoped lookup. The inherited findById used here previously carried no
        // tenant predicate, and pos_db's RLS was inert against the owning role — so another
        // tenant's item could be added to this order and priced at that tenant's price. FORCE RLS
        // (V11) now blocks this at the database; the predicate below is the second line.
        MenuItem menuItem = menuItemRepository.findByIdAndTenantId(request.menuItemId(), tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Menu item not found: " + request.menuItemId()));

        // SECURITY (branch isolation): resolve branch-override pricing from the ORDER's own
        // (server-derived, createOrder-validated) branch rather than the client-supplied
        // request.branchId() — the order already carries the authoritative branch, so a spoofed
        // request branchId can no longer pull another branch's override price onto this line.
        Optional<BranchMenuOverride> override = overrideRepository
                .findByBranchIdAndMenuItemId(order.getBranchId(), request.menuItemId());

        long unitPrice = pricingCalculator.effectiveUnitPrice(menuItem, override.orElse(null));

        OrderItem item = new OrderItem();
        item.setTenantId(tenantId);
        item.setOrder(order);
        item.setMenuItemId(menuItem.getId());
        item.setItemNameSnapshot(menuItem.getName());
        item.setUnitPriceSnapshot(unitPrice);
        item.setQuantity(request.quantity());
        // Phase 28 (28-05): the destination is resolved through the ONE resolver, using the
        // ORDER'S OWN branch — the server-derived one the order already carries, never a branch
        // supplied on the request. The order is the authority for its own branch; this is the same
        // reasoning the branch-override price lookup two lines away already applies.
        //
        // Phase 3's snapshot invariant is UNCHANGED and is load-bearing: BOTH routing keys are
        // captured at add-item time and NEVER at fire time, so a later menu re-assignment can
        // never retroactively re-route an already-added line. Two tests in MenuStationRoutingIT
        // exist solely to fail if this resolution ever moves to sendToKds.
        var resolvedStation = stationRoutingResolver.resolve(tenantId, order.getBranchId(), menuItem);
        // The free-text key DOES keep its historical fallback: when nothing resolves, the line
        // carries the item's own kds_station snapshot exactly as it always has, and sendToKds
        // coalesces that to DEFAULT. That path is unchanged for every tenant who configures
        // nothing, which is every tenant on the day this ships.
        item.setKdsStation(resolvedStation
                .map(io.restaurantos.pos.domain.model.Station::getCode)
                .orElseGet(menuItem::getKdsStation));
        // NO fallback to menuItem.getStationId() here, deliberately. The resolver ALREADY
        // considers that column (step 3) and refuses it when it names a station in a different
        // branch — which is the bug this plan closes. Re-adding it as a fallback would reinstate
        // exactly the cross-branch mis-route, one line below the code that prevents it.
        item.setStationId(resolvedStation
                .map(io.restaurantos.pos.domain.model.Station::getId)
                .orElse(null));
        item.setNotes(request.notes());

        // S6 — modifiers, resolved against the real catalogue instead of stubbed.
        //
        // What stood here set `modifierNameSnapshot` to `modifierId.toString()` and
        // `priceDeltaPaisa` to 0L unconditionally, under the comment "for simplicity use a direct
        // lookup". There was no lookup. Both of those fields are PRINTED: KitchenTicketAssembler
        // puts the name snapshot on the chef's ticket and ReceiptDocumentAssembler puts it on the
        // guest's bill, and the delta feeds `pricingCalculator.lineSubtotal` two calls below. So
        // "extra cheese" reached the pass as a hex string and reached the till at zero — the
        // kitchen cooked the wrong dish and the restaurant gave the topping away.
        //
        // The resolver is also where the FORCED/min/max rules are enforced. They live on the
        // server rather than only in the configure dialog because the dialog is not the only
        // caller: Order Management's Quick Add, an offline till draining its outbox, and anything
        // speaking to this endpoint directly all arrive here. A rule enforced only in a dialog is
        // a rule that is true only while the dialog is open.
        List<Long> modifierDeltas = new ArrayList<>();
        for (var resolved : modifierSelectionResolver.resolve(
                tenantId, menuItem.getId(), menuItem.getName(), request.modifierIds())) {
            OrderItemModifier oim = new OrderItemModifier();
            oim.setTenantId(tenantId);
            oim.setOrderItem(item);
            oim.setModifierId(resolved.modifierId());
            // SNAPSHOT, at add-item time, for the same reason `unitPriceSnapshot`, the two routing
            // keys and the tax rate on this line are: re-pricing "Extra cheese" next month must
            // not change what last month's bill says the guest paid.
            oim.setModifierNameSnapshot(resolved.name());
            oim.setPriceDeltaPaisa(resolved.priceDeltaPaisa());
            item.getModifiers().add(oim);
            modifierDeltas.add(resolved.priceDeltaPaisa());
        }

        // F16 — the rate this line is charged at comes from the ONE resolver: the item's own tax
        // class, else its category's, else the item's legacy rate columns, else zero. It is NOT
        // `menuItem.getTaxRatePct()`, which is only the last of those four and which is 0.00 on
        // most rows in most tenants — reading it directly is what taxed a Rs 1,657.00 check at
        // 1.5%, because only the lines that had been given a per-item rate carried one.
        var resolvedTax = taxClassResolver.resolve(tenantId, menuItem);

        // Compute line pricing
        var lineResult = pricingCalculator.computeItemLine(
                unitPrice,
                modifierDeltas,
                request.quantity(),
                0L,
                resolvedTax.ratePct());

        item.setDiscountPaisa(lineResult.discountPaisa());
        item.setTaxPaisa(lineResult.taxPaisa());
        item.setLineTotalPaisa(lineResult.lineTotalPaisa());
        // SNAPSHOT, at add-item time, exactly like unitPriceSnapshot and the two routing keys
        // above — and for the same reason. Before this, the receipt's tax breakdown re-read the
        // LIVE menu_items row at print time: reprint a bill after a rate change and old money was
        // attributed to a new rate. The bill now says what the guest was actually charged, and
        // keeps saying it.
        item.setTaxRatePct(resolvedTax.ratePct());
        item.setTaxRateCode(resolvedTax.rateCode());
        item.setTaxClassName(resolvedTax.label());

        order.getItems().add(item);

        // Transition DRAFT -> OPEN on first item
        boolean firstItem = order.getStatus() == OrderStatus.DRAFT;
        if (firstItem) {
            stateMachine.assertTransition(OrderStatus.DRAFT, OrderStatus.OPEN);
            order.setStatus(OrderStatus.OPEN);
            order.setOpenedAt(Instant.now());
            order.setOrderNo(generateOrderNo(tenantId, order.getBranchId()));

            // Table-status derivation, single seam (RESEARCH.md Pitfall 5): DRAFT->OPEN with
            // a bound table marks it OCCUPIED (derivedStatus is still its initial DRAFT here).
            tableService.syncStatusForOrder(order.getTableId(), order.getBranchId(),
                    order.getStatus(), order.getDerivedStatus());
        }

        recomputeOrderTotals(order);
        order = orderRepository.save(order);

        // Publish ORDER_CREATED on transition to OPEN
        if (firstItem) {
            var payload = new PosEventPayloads.OrderCreatedPayload(
                    order.getId(),
                    tenantId,
                    order.getBranchId(),
                    order.getOrderNo(),
                    order.getType().name(),
                    order.getTableId(),
                    order.getCoverCount(),
                    order.getCashierId(),
                    order.getCustomerId(),
                    order.getClientOrderId()
            );
            eventPublisher.publish(POS_EXCHANGE, ORDER_CREATED_KEY, ORDER_CREATED_TYPE,
                    order.getBranchId(), payload);
        }

        return orderMapper.toDto(order);
    }

    @Override
    public OrderDto removeItem(UUID orderId, UUID itemId) {
        UUID tenantId = tenantContext.requireTenantId();
        Order order = findOrderForTenant(orderId, tenantId);

        if (order.getStatus() != OrderStatus.OPEN) {
            throw new io.restaurantos.shared.exception.StateInvalidException(
                    "Cannot remove items from order in status: " + order.getStatus());
        }

        boolean removed = order.getItems().removeIf(item -> item.getId().equals(itemId));
        if (!removed) {
            throw new ResourceNotFoundException("Order item not found: " + itemId);
        }

        recomputeOrderTotals(order);
        return orderMapper.toDto(orderRepository.save(order));
    }

    @Override
    public OrderDto applyPromotions(UUID orderId) {
        UUID tenantId = tenantContext.requireTenantId();
        Order order = findOrderForTenant(orderId, tenantId);

        if (order.getCustomerId() == null) {
            // Walk-in: nothing to evaluate tier-based promotions against.
            return orderMapper.toDto(order);
        }

        List<CrmPromotionClient.EvaluatePromotionRequest.OrderItemLine> lines = order.getItems().stream()
                .filter(i -> i.getItemStatus() != OrderItemStatus.CANCELLED)
                .map(i -> new CrmPromotionClient.EvaluatePromotionRequest.OrderItemLine(
                        i.getMenuItemId(), i.getLineTotalPaisa()))
                .toList();

        CrmPromotionClient.EvaluatePromotionResponse result = crmPromotionClient.evaluate(
                new CrmPromotionClient.EvaluatePromotionRequest(
                        order.getBranchId(), order.getCustomerId(),
                        order.getSubtotalPaisa(), Instant.now(), lines));

        if (result == null || result.discountPaisa() <= 0) {
            return orderMapper.toDto(order);
        }

        // Replace, never stack: re-running the evaluation must be idempotent in effect.
        order.getDiscounts().removeIf(d -> PROMOTION_DISCOUNT_TYPE.equals(d.getType()));

        OrderDiscount discount = new OrderDiscount();
        discount.setTenantId(tenantId);
        discount.setOrder(order);
        discount.setScope("ORDER");
        discount.setType(PROMOTION_DISCOUNT_TYPE);
        long capped = Math.min(result.discountPaisa(), order.getSubtotalPaisa());
        discount.setAmountPaisa(capped);
        discount.setValue(BigDecimal.valueOf(capped));
        // B3: `reason` is NOT NULL since V22 and this is the one other path that writes a
        // discount row. The engine's reason is the engine itself — an automatic discount was
        // still a decision, and the Discount Summary must be able to tell it from a manager's.
        discount.setReason("Automatic promotion (customer's qualifying offer)");
        order.getDiscounts().add(discount);

        recomputeOrderTotals(order);
        return orderMapper.toDto(orderRepository.save(order));
    }

    /**
     * Apply a discount to one line, or to the whole check (B3).
     *
     * <h2>WHEN a discount may be given, and why the old rule was the wrong one</h2>
     *
     * <p>This method used to refuse anything that was not {@code OPEN}. A discount in a restaurant
     * is decided when the bill is presented, which is by definition <em>after</em> the food has
     * been fired — so the only discountable check under that rule was one nobody had cooked yet,
     * and every real request ("we waited 40 minutes", "the biryani was cold") answered
     * {@code 409 Cannot apply discount to order in status: SENT_TO_KDS}. Measured on both the
     * cashier and the manager, at both scopes, on 2026-08-12.
     *
     * <p>The rule that replaces it is the one the trade actually uses: a check is discountable
     * while it is still <em>live</em> — anything from OPEN through SERVED — and stops being
     * discountable the moment it is settled or written off. Concretely:
     *
     * <ul>
     *   <li>DRAFT is refused because there is nothing on it to discount yet.</li>
     *   <li>CLOSED / VOIDED / REFUNDED are refused because the money has already been accounted
     *       for; reducing the total afterwards would silently contradict a journal entry that
     *       finance has already posted. The correct instrument after settlement is a refund.</li>
     *   <li>A check already paid in full is refused for the same reason, even though it may still
     *       be technically open (POS-23 closes only on paid AND served). The guest has handed the
     *       money over; taking the bill down now means giving some back, which is a refund.</li>
     *   <li>A partly-paid check whose new total would fall <em>below</em> what has already been
     *       tendered is refused after pricing, naming both figures.</li>
     * </ul>
     *
     * <h2>WHO may give which discount</h2>
     *
     * <p>A CASHIER holds {@code pos.order.discount.line} and not {@code pos.order.discount.override}.
     * That split is deliberate and is kept: the person in front of the guest can take a line off,
     * and taking a percentage off the whole check is a manager's decision. So ORDER scope — and
     * only ORDER scope — is put through the policy. The UI states which is which up front rather
     * than offering both and 403-ing afterwards.
     *
     * <h2>Replace, never stack</h2>
     *
     * <p>A second discount at the same scope <em>replaces</em> the first rather than adding to it,
     * exactly as {@link #applyPromotions} already does. Stacking is how a double-tap becomes 20%
     * off; and "the discount on this line is 10%" is what a cashier believes they are saying.
     * Correcting a mistake is therefore re-applying, which needs no separate control and no
     * separate permission.
     */
    @Override
    public OrderDto applyDiscount(UUID orderId, ApplyDiscountRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        Order order = findOrderForTenant(orderId, tenantId);

        assertDiscountable(order);

        // Also enforced by @NotBlank/@Size on the DTO, which is what turns a bad API call into a
        // 400 with a field path. Repeated here because bean validation only runs on the
        // @Valid-annotated controller argument: every other caller of this service — a future
        // internal endpoint, a batch job, a test — would otherwise write a reasonless discount
        // straight past the rule, and `reason` is NOT NULL in the schema, so the failure would
        // surface as a constraint violation nobody can read.
        String reason = request.reason() == null ? "" : request.reason().trim();
        if (reason.length() < 3) {
            throw new io.restaurantos.shared.exception.FieldValidationException(
                    "DISCOUNT_REASON_REQUIRED", "reason",
                    "Say why the discount is being given — at least 3 characters.");
        }

        boolean orderScope = "ORDER".equals(request.scope());
        if (!orderScope && request.orderItemId() == null) {
            throw new io.restaurantos.shared.exception.FieldValidationException(
                    "DISCOUNT_LINE_REQUIRED", "orderItemId",
                    "Choose which item on the check the discount comes off.");
        }

        // pos.rego's pos.order.discount.override rule. Scoped to whole-order discounts — see
        // PosAuthorizationService.authorizeDiscountOverride for why a line discount is not gated
        // by it (doing so would refuse cashiers a discount they can legitimately apply today).
        if (orderScope) {
            posAuthorizationService.authorizeDiscountOverride(
                    orderId, tenantId, order.getBranchId(),
                    order.getCashierId(), order.getStatus().name());
        }

        OrderItem line = null;
        if (!orderScope) {
            line = order.getItems().stream()
                    .filter(i -> i.getId().equals(request.orderItemId()))
                    .findFirst()
                    .orElseThrow(() -> new ResourceNotFoundException(
                            "Order item not found: " + request.orderItemId()));
            if (line.getItemStatus() == OrderItemStatus.CANCELLED) {
                throw new io.restaurantos.shared.exception.StateInvalidException(
                        "That line was cancelled, so it is not on the bill and cannot be discounted.");
            }
        }

        // Replace, never stack — see the class comment on this method.
        if (orderScope) {
            order.getDiscounts().removeIf(d -> "ORDER".equals(d.getScope())
                    && !PROMOTION_DISCOUNT_TYPE.equals(d.getType()));
        } else {
            UUID itemId = request.orderItemId();
            order.getDiscounts().removeIf(d -> "LINE".equals(d.getScope())
                    && itemId.equals(d.getOrderItemId()));
        }

        long amountPaisa = computeDiscountAmount(request, order, line);

        OrderDiscount discount = new OrderDiscount();
        discount.setTenantId(tenantId);
        discount.setOrder(order);
        discount.setScope(request.scope());
        discount.setType(request.type());
        discount.setValue(request.value());
        discount.setAmountPaisa(amountPaisa);
        discount.setOrderItemId(orderScope ? null : request.orderItemId());
        discount.setReason(reason);
        UUID appliedBy = tenantContext.getUserId().orElse(null);
        discount.setAppliedBy(appliedBy);
        discount.setAppliedByName(staffNameDirectory.resolve(tenantId, appliedBy));
        order.getDiscounts().add(discount);

        recomputeOrderTotals(order);

        // Priced last, checked last: a partly-tendered check must not be discounted below what the
        // guest has already handed over. The figures are named because "not allowed" tells a
        // cashier nothing they can act on.
        long paidPaisa = orderPaymentRepository.sumAmountByOrderId(orderId);
        if (paidPaisa > 0 && order.getTotalPaisa() < paidPaisa) {
            throw new io.restaurantos.shared.exception.StateInvalidException(
                    "That discount would take the bill to " + rupees(order.getTotalPaisa())
                            + ", below the " + rupees(paidPaisa)
                            + " already paid. Refund the difference instead.");
        }

        return orderMapper.toDto(orderRepository.save(order));
    }

    /**
     * The states in which a check may still be discounted: everything from the moment it has
     * something on it until the moment it is settled or written off. See {@link #applyDiscount}.
     */
    private static final Set<OrderStatus> DISCOUNTABLE_STATUSES = EnumSet.of(
            OrderStatus.OPEN,
            OrderStatus.SENT_TO_KDS,
            OrderStatus.PARTIAL_READY,
            OrderStatus.READY,
            OrderStatus.SERVED);

    /** Refuses in the guest's language, not the state machine's. */
    private void assertDiscountable(Order order) {
        if (!DISCOUNTABLE_STATUSES.contains(order.getStatus())) {
            String why = switch (order.getStatus()) {
                case DRAFT -> "There is nothing on this check yet — add an item before discounting it.";
                case CLOSED -> "This check is closed and its sale has been posted. "
                        + "Refund the guest instead of discounting it.";
                case VOIDED -> "This check was voided, so there is nothing left to discount.";
                case REFUNDED -> "This check was refunded, so there is nothing left to discount.";
                default -> "This check cannot be discounted in its current state.";
            };
            throw new io.restaurantos.shared.exception.StateInvalidException(why);
        }
        long paidPaisa = orderPaymentRepository.sumAmountByOrderId(order.getId());
        if (paidPaisa > 0 && paidPaisa >= order.getTotalPaisa()) {
            throw new io.restaurantos.shared.exception.StateInvalidException(
                    "This check has already been paid in full (" + rupees(paidPaisa)
                            + "). Refund the guest instead of discounting it.");
        }
    }

    /** Paisa as the rupees a human reads, for refusals a cashier has to act on. */
    private static String rupees(long paisa) {
        return "Rs " + BigDecimal.valueOf(paisa, 2).toPlainString();
    }

    @Override
    public OrderDto sendToKds(UUID orderId, String clientFireId) {
        UUID tenantId = tenantContext.requireTenantId();

        // Per-fire idempotency (RESEARCH.md §4): a NEW key namespace per fire action,
        // NOT clientOrderId (which is one-per-order). Optional — callers without an
        // Idempotency-Key header always fire immediately (backward-compatible).
        String idempotencyKey = (clientFireId != null && !clientFireId.isBlank())
                ? "sendToKds:" + orderId + ":" + clientFireId
                : null;

        if (idempotencyKey != null) {
            Optional<String> stored = idempotencyService.getCompletedResponse(idempotencyKey);
            if (stored.isPresent()) {
                return orderMapper.toDto(findOrderForTenant(orderId, tenantId));
            }
            boolean claimed = idempotencyService.checkAndLock(idempotencyKey, orderId.toString(), 86400);
            if (!claimed) {
                // Already in flight or completed — return current order state (no re-publish).
                return orderMapper.toDto(findOrderForTenant(orderId, tenantId));
            }
        }

        Order order = findOrderForTenant(orderId, tenantId);

        // Loosened guard (Task 1 self-loops): repeated fires stay on SENT_TO_KDS; terminal
        // orders (CLOSED/VOIDED/REFUNDED) still reject via the state machine's empty
        // transition sets, symmetric with addItem's isTerminal check.
        stateMachine.assertTransition(order.getStatus(), OrderStatus.SENT_TO_KDS);

        // Fire-only-unfired-items (RESEARCH.md Pattern 1): this is the ONLY seam that
        // builds the KDS payload item list — never order.getItems() wholesale (Pitfall 1).
        List<OrderItem> newItems = order.getItems().stream()
                .filter(item -> item.getItemStatus() == OrderItemStatus.PENDING)
                .toList();

        if (newItems.isEmpty()) {
            throw new PosExceptions.ZeroValueOrderException("Nothing new to send to kitchen");
        }

        int nextRevision = order.getItems().stream()
                .mapToInt(OrderItem::getRevisionNo)
                .max()
                .orElse(0) + 1;

        Instant firedAt = Instant.now();
        for (OrderItem item : newItems) {
            item.setItemStatus(OrderItemStatus.SENT);
            item.setRevisionNo(nextRevision);
            item.setFiredAt(firedAt);
        }

        // Settlement/state-machine transition kept for event-contract compatibility — the
        // kitchen-progress MEANING of this field is retired in favor of derivedStatus below
        // (Pitfall 3): order.status simply records "has been sent to KDS at least once".
        order.setStatus(OrderStatus.SENT_TO_KDS);
        order.setSentToKdsAt(firedAt);

        // derivedStatus is the single source of truth for kitchen-progress aggregation —
        // computed via the pure derivation seam, never hand-set (POS-11 / Pitfall 3).
        order.setDerivedStatus(orderStatusDerivationService.derive(order.getItems()));
        tableService.syncStatusForOrder(order.getTableId(), order.getBranchId(),
                order.getStatus(), order.getDerivedStatus());

        order = orderRepository.save(order);

        // Phase 3: resolve the canonical station (code + name) for any fired line carrying a
        // station_id FK snapshot — batched into one lookup for the whole fire. A line with a
        // station FK emits that station's canonical code in kdsStation (kept load-bearing as the
        // kitchen's ticket/WS key) PLUS the new additive stationId/stationName; a line with no FK
        // keeps its free-text kds_station snapshot, coalesced to "DEFAULT".
        Set<UUID> firedStationIds = newItems.stream()
                .map(OrderItem::getStationId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        Map<UUID, Station> stationsById = firedStationIds.isEmpty()
                ? Map.of()
                : stationRepository.findAllById(firedStationIds).stream()
                        .collect(Collectors.toMap(Station::getId, s -> s));

        // Build KDS payload from ONLY the newly-fired lines.
        List<PosEventPayloads.KdsItemPayload> kdsItems = newItems.stream()
                .map(item -> {
                    Station station = item.getStationId() != null ? stationsById.get(item.getStationId()) : null;
                    String stationCode = station != null
                            ? station.getCode()
                            : (item.getKdsStation() != null ? item.getKdsStation() : DEFAULT_KDS_STATION);
                    UUID stationId = station != null ? station.getId() : null;
                    String stationName = station != null ? station.getName() : null;
                    // The DEFAULT rather than null when no FK resolves (D-28-01). A null would
                    // make every consumer decide what a missing type means, and they would not
                    // all decide the same thing.
                    String stationType = station != null && station.getStationType() != null
                            ? station.getStationType().name()
                            : StationType.DEFAULT.name();
                    return new PosEventPayloads.KdsItemPayload(
                            item.getId(),
                            item.getMenuItemId(),
                            item.getItemNameSnapshot(),
                            item.getQuantity(),
                            stationCode,
                            item.getModifiers().stream()
                                    .map(OrderItemModifier::getModifierNameSnapshot)
                                    .collect(Collectors.toList()),
                            item.getNotes(),
                            stationId,
                            stationName,
                            stationType
                    );
                })
                .collect(Collectors.toList());

        // KDS-04 (pos-side, additive parity field): resolve the order's table number — null
        // for takeaway/pickup orders with no bound table. Field NAME must match the
        // kitchen-service consumer's matching field exactly (lands in 07.3-05).
        // Resolves retired tables too (findByIdTenantAndBranch is not filtered on is_active):
        // an order already bound to a table that was retired mid-service must still print the
        // table it is being served at, on the ticket the kitchen reads.
        String tableNumber = order.getTableId() != null
                ? tableRepository.findByIdTenantAndBranch(order.getTableId(), tenantId, order.getBranchId())
                        .map(DiningTable::getTableNumber)
                        .orElse(null)
                : null;

        var payload = new PosEventPayloads.OrderSentToKdsPayload(
                order.getId(),
                tenantId,
                order.getBranchId(),
                order.getOrderNo(),
                kdsItems,
                nextRevision,
                order.getNotes(),
                tableNumber,
                order.getType() != null ? order.getType().name() : null
        );
        eventPublisher.publish(POS_EXCHANGE, ORDER_SENT_TO_KDS_KEY, ORDER_SENT_TO_KDS_TYPE,
                order.getBranchId(), payload);

        // 26-07: the paper ticket, registered to run AFTER this transaction commits and never
        // inside it. Nothing about printing may fail a fire — and a try/catch here would NOT
        // achieve that, because a constraint breach on the print insert would mark this very
        // transaction rollback-only and the fire would still fail at commit. See
        // PrintDispatchService's header for the full argument and for why REQUIRES_NEW is also
        // wrong. The set handed over is the one THIS method just stamped; the ticket does not
        // re-derive which lines are new.
        Set<UUID> firedItemIds = newItems.stream().map(OrderItem::getId).collect(Collectors.toSet());
        printDispatchService.dispatchKitchenTicketsAfterCommit(
                order.getId(), order.getBranchId(), nextRevision, firedItemIds);

        OrderDto dto = orderMapper.toDto(order);
        if (idempotencyKey != null) {
            idempotencyService.markComplete(idempotencyKey, dto.id().toString());
        }
        return dto;
    }

    @Override
    @Transactional(readOnly = true)
    public OrderDto getOrder(UUID orderId, UUID branchId) {
        // SECURITY (branch isolation): branchId is a request parameter (controller convention),
        // but a client-supplied sibling branchId must not be able to read another branch's order
        // within the same tenant — RLS is tenant-only, so this guard is the boundary.
        requireOwnBranch(branchId);
        Order order = orderRepository.findByIdAndBranchId(orderId, branchId)
                .orElseThrow(() -> new PosExceptions.OrderNotFoundException(orderId.toString()));
        return orderMapper.toDto(order);
    }

    /**
     * Defense-in-depth against a client-supplied {@code branchId} that widens scope beyond the
     * caller's JWT branch. Mirrors {@code TableServiceImpl.requireOwnBranch} and the inline guard
     * in {@link #listOrderSummaries} — {@code branchId} stays an explicit request parameter (the
     * controller's existing convention) but must always equal the verified JWT branch.
     */
    private void requireOwnBranch(UUID branchId) {
        UUID jwtBranchId = tenantContext.getBranchId()
                .orElseThrow(() -> new PermissionDeniedException("Branch context required"));
        if (!jwtBranchId.equals(branchId)) {
            throw new PermissionDeniedException("Cannot access resources for a different branch");
        }
    }

    @Override
    @Transactional(readOnly = true)
    public Page<OrderDto> listOrders(UUID branchId, List<String> statuses, Pageable pageable) {
        // Same guard as listOrderSummaries, and for the same reason (T-07.1d-01): branchId is a
        // client-supplied request parameter, so without this a caller can list ANY branch's orders
        // — including another tenant's — simply by passing its id. This method was the unguarded
        // twin of listOrderSummaries, which was hardened while this one was not.
        //
        // There is no database backstop to fall back on: pos_db's tables are ENABLE (not FORCE)
        // ROW LEVEL SECURITY and the application owns them, so RLS is inert for this connection
        // and isolation here is service-layer only.
        UUID jwtBranchId = tenantContext.getBranchId()
                .orElseThrow(() -> new PermissionDeniedException("Branch context required"));
        if (!jwtBranchId.equals(branchId)) {
            throw new PermissionDeniedException("Cannot list orders for a different branch");
        }

        List<OrderStatus> statusEnums = statuses == null || statuses.isEmpty()
                ? List.of(OrderStatus.values())
                : statuses.stream().map(OrderStatus::valueOf).collect(Collectors.toList());
        return orderRepository.findByTenantIdAndBranchIdAndStatusIn(
                        tenantContext.requireTenantId(), branchId, statusEnums, pageable)
                .map(orderMapper::toDto);
    }

    @Override
    @Transactional(readOnly = true)
    public Page<OrderSummaryDto> listOrderSummaries(UUID branchId, List<String> statuses,
                                                    Pageable pageable) {
        return listOrderSummaries(branchId, statuses, null, pageable);
    }

    @Override
    @Transactional(readOnly = true)
    public Page<OrderSummaryDto> listOrderSummaries(UUID branchId, List<String> statuses, String q,
                                                    Pageable pageable) {
        // branchId is a request parameter (matches the rest of this controller's existing
        // convention), but it must never widen scope beyond the caller's verified JWT branch
        // (T-07.1d-01 — a client-supplied branchId could otherwise leak cross-branch orders).
        UUID jwtBranchId = tenantContext.getBranchId()
                .orElseThrow(() -> new PermissionDeniedException("Branch context required"));
        if (!jwtBranchId.equals(branchId)) {
            throw new PermissionDeniedException("Cannot list orders for a different branch");
        }

        UUID tenantId = tenantContext.requireTenantId();
        String term = (q == null || q.isBlank()) ? null : q.trim();

        // Default (no explicit status filter) = ALL non-terminal statuses EXCLUDING DRAFT
        // (POS-16: a client-only cart never persists a DB order, so DRAFT rows are stale
        // abandoned carts, not active orders — they must never surface in Order Management).
        // A caller can still explicitly request DRAFT or a terminal status (e.g. [CLOSED])
        // via the statuses param; only the empty-filter DEFAULT excludes them.
        //
        // S0-05: a SEARCH with no explicit statuses spans every status instead. Someone typing
        // an order number has already named the one row they want; answering "No active orders"
        // because that check was voided is the page pretending the order does not exist.
        List<OrderStatus> statusEnums;
        if (statuses != null && !statuses.isEmpty()) {
            statusEnums = statuses.stream().map(OrderStatus::valueOf).collect(Collectors.toList());
        } else if (term != null) {
            statusEnums = Arrays.asList(OrderStatus.values());
        } else {
            statusEnums = Arrays.stream(OrderStatus.values())
                    .filter(s -> !isTerminal(s) && s != OrderStatus.DRAFT)
                    .collect(Collectors.toList());
        }

        // ALL tables, not just active ones — an order placed at a table that has since been
        // retired must still show its name in the order list, or the row reads "—" and the
        // manager cannot tell which table the money came from.
        //
        // Loaded BEFORE the order query, not after: a search matches on table NAME, and this map
        // is where the names live.
        Map<UUID, String> tableNames = tableRepository
                .findAllByTenantAndBranch(tenantId, branchId).stream()
                .collect(Collectors.toMap(DiningTable::getId, DiningTable::getTableNumber));

        // Own-vs-all-branch visibility (SECURITY — T-07.1d-01): silently scope to the
        // caller's own orders unless they hold the all-branch view permission. Never a
        // client-controllable filter. The searched variants below carry the same rule — search
        // must not be the hole a cashier reads a colleague's checks through.
        boolean viewAll = posAuthorizationService.hasPermission(VIEW_ALL_PERMISSION);
        UUID callerId = tenantContext.getUserId().orElse(null);

        Page<Order> orders;
        if (term == null) {
            orders = viewAll
                    ? orderRepository.findByBranchIdAndStatusIn(branchId, statusEnums, pageable)
                    : orderRepository.findByBranchIdAndStatusInAndCashierId(
                            branchId, statusEnums, callerId, pageable);
        } else {
            Collection<UUID> tableIds = matchingTableIds(tableNames, term);
            Collection<UUID> customerIds = matchingCustomerIds(term, tenantId);
            orders = viewAll
                    ? orderRepository.searchByTenantAndBranch(
                            tenantId, branchId, statusEnums, term, tableIds, customerIds, pageable)
                    : orderRepository.searchByTenantAndBranchAndCashierId(
                            tenantId, branchId, statusEnums, term, tableIds, customerIds, callerId, pageable);
        }

        // Batched payment sums for the WHOLE page in one query (N+1 avoidance, POS-24) — never
        // call orderPaymentRepository.sumAmountByOrderId per row.
        List<UUID> orderIds = orders.getContent().stream().map(Order::getId).collect(Collectors.toList());
        Map<UUID, Long> paidByOrderId = orderIds.isEmpty()
                ? Map.of()
                : orderPaymentRepository.sumAmountByOrderIds(orderIds).stream()
                        .collect(Collectors.toMap(
                                OrderPaymentRepository.OrderPaymentSum::getOrderId,
                                OrderPaymentRepository.OrderPaymentSum::getTotalPaisa));

        return orders.map(order -> toSummaryDto(order, tableNames, paidByOrderId));
    }

    /**
     * Never-matching id for an empty {@code IN (…)} list. JPQL has no portable empty-IN, and the
     * search predicate ORs three clauses — dropping one when it has no candidates would mean
     * building the query string by hand.
     */
    private static final UUID NO_MATCH = UUID.fromString("00000000-0000-0000-0000-000000000000");

    /** Table ids whose NAME contains the term, case-insensitively (e.g. "t1" finds table T1). */
    private static Collection<UUID> matchingTableIds(Map<UUID, String> tableNames, String term) {
        String needle = term.toLowerCase(Locale.ROOT);
        List<UUID> ids = tableNames.entrySet().stream()
                .filter(e -> e.getValue() != null && e.getValue().toLowerCase(Locale.ROOT).contains(needle))
                .map(Map.Entry::getKey)
                .collect(Collectors.toList());
        return ids.isEmpty() ? List.of(NO_MATCH) : ids;
    }

    /**
     * Customer ids matching the term by phone prefix or name, resolved from crm-service.
     *
     * <p>A CRM outage must NOT take the whole search down with it: order-number and table
     * matching are answered entirely from pos_db and stay correct without CRM. So the failure
     * is logged at WARN and degrades to "no customer matches" rather than 500ing a manager who
     * was only looking for a check number. The log line is the honest part — this returns fewer
     * rows than it should, and silence about that is how a degraded search becomes a permanent
     * one nobody notices.
     */
    private Collection<UUID> matchingCustomerIds(String term, UUID tenantId) {
        try {
            List<UUID> ids = crmCustomerSearchClient.searchCustomerIds(term, CUSTOMER_MATCH_LIMIT, tenantId);
            if (ids != null && !ids.isEmpty()) {
                return ids;
            }
        } catch (RuntimeException e) {
            log.warn("Order search could not reach crm-service to resolve customers for \"{}\" — "
                    + "results exclude customer phone/name matches", term, e);
        }
        return List.of(NO_MATCH);
    }

    @Override
    public OrderDto voidOrder(UUID orderId, VoidOrderRequest request, String idempotencyKey) {
        // Idempotency: return early if already completed
        Optional<String> stored = idempotencyService.getCompletedResponse(idempotencyKey);
        UUID tenantId = tenantContext.requireTenantId();
        Order order = findOrderForTenant(orderId, tenantId);
        if (stored.isPresent()) {
            return orderMapper.toDto(order);
        }

        // ── MONEY (S0-01): a void must never outrun a payment ────────────────────────────
        // A void cancels a BILL. It moves no money and writes no reversing row, so voiding an
        // order that has been paid deleted the order from Order Management, from all seven
        // status filters and from search while its order_payments row stayed live in the
        // database — cash in the drawer, nothing on any report. Three gates all failed to
        // notice: this method never read a payment total, OrderStateMachine permitted
        // X -> VOIDED from every non-terminal state, and refund was CLOSED-only (a paid but
        // unserved order is SENT_TO_KDS, never CLOSED, so the operator's ONLY working button
        // was the destructive one).
        //
        // The policy is decided here, once, and it is the strict one: ANY recorded payment
        // refuses the void. Not "fully paid" — a partial tender is money in the drawer too,
        // and a void would strand it exactly the same way. Refund is the path that has a
        // reversing money row, and RefundServiceImpl now accepts every paid order, not only
        // CLOSED ones, so refusing here never leaves the operator without an action.
        //
        // Checked BEFORE the idempotency key is claimed: a refusal must stay retryable, and a
        // claimed-but-never-completed key makes the next attempt return "success" (the
        // !claimed branch below) without voiding anything.
        long amountPaidPaisa = orderPaymentRepository.sumAmountByOrderId(orderId);
        if (amountPaidPaisa > 0) {
            throw new PosExceptions.OrderHasPaymentsException(order.getOrderNo(), amountPaidPaisa);
        }

        // F2: the reason is HASHED, not passed through.
        //
        // This line read `checkAndLock(idempotencyKey, request.reason(), 86400)`. The parameter is
        // named `requestHash` and its column is `idempotency_keys.request_hash VARCHAR(64)` — a
        // width chosen for a SHA-256 hex digest — while `VoidOrderRequest.reason` is validated at
        // `@Size(max = 500)`. So every void whose reason ran past 64 characters died in the
        // database, and the operator was told nothing they could act on. Measured live on
        // 2026-08-12 with a 149-character reason, as manager@terrace.local:
        //
        //   POST /api/v1/pos/orders/{id}/void → 409
        //   {"error":{"code":"CONFLICT","message":"This conflicts with existing data", …}}
        //   pos-service: SQLState 22001 — ERROR: value too long for type character varying(64)
        //   on screen:   "Failed to void. Please try again."
        //
        // "Please try again" was advice that could never work: the same reason fails identically
        // every time. And the reason a manager writes when they void a check is a sentence, not a
        // word — the walkthrough's own examples run to 57 characters before anyone is trying.
        //
        // Hashing preserves the idempotency contract exactly (same key + same request ⇒ same
        // digest ⇒ the retry is recognised) and makes the column's width correct by construction
        // rather than by luck. The identical mistake is still live one file over, at
        // RefundServiceImpl:94 — `request.reason() + request.refundPaisa()` — and is reported
        // rather than fixed here because that file is held open by another change.
        boolean claimed = idempotencyService.checkAndLock(
                idempotencyKey, sha256Hex(request.reason()), 86400);
        if (!claimed) {
            return orderMapper.toDto(order);
        }

        // OPA authorization: void.own for the cashier's own un-tendered, un-plated check,
        // void.any for manager level. `amountPaidPaisa` is always 0 by the time control reaches
        // here — the guard above returned otherwise — and it is still passed as the measured
        // value rather than a literal, because pos.rego's money clause guards every caller of
        // this method, not only voidOrder. authorization-service exposes the same (module,
        // action) pair over HTTP to anyone.
        //
        // ── THE PASS (B2 re-open): why a third fact is measured here ─────────────────────────
        // pos.rego's void.own draws the cashier's ceiling at the pass — a guest who walks out
        // before the food is cooked is the cashier's own correction; writing off food that WAS
        // cooked is a manager's call. That boundary used to be expressed as a status set,
        // {DRAFT, OPEN, SENT_TO_KDS}, and it was inert: order.status never leaves SENT_TO_KDS
        // while a check is live, because PARTIAL_READY/READY/SERVED were retired as order-level
        // states in fc6f389f. The set therefore covered every status an unpaid check can hold and
        // constrained nothing. Measured live 2026-08-12: ORD-20260812-0340, serve-all 200 with
        // derivedStatus SERVED and status still SENT_TO_KDS, then the cashier's OWN void 200.
        //
        // derivedStatus cannot stand in for it either — derive() collapses READY into IN_PROGRESS
        // and only breaks out served, so a plate under the heat lamp is indistinguishable from a
        // ticket fired seconds ago. The question is asked of the LINES, which are the only place
        // the answer lives, and it is asked here rather than stored so it cannot drift.
        boolean anyLinePlated = orderStatusDerivationService.anyLinePlated(order.getItems());
        posAuthorizationService.authorizeVoid(
                orderId, tenantId, order.getBranchId(),
                order.getCashierId(), order.getStatus().name(), amountPaidPaisa, anyLinePlated);

        stateMachine.assertTransition(order.getStatus(), OrderStatus.VOIDED);
        order.setStatus(OrderStatus.VOIDED);
        order.setVoidReason(request.reason());
        order.setVoidedAt(Instant.now());
        // S0-04: persist the actor. Until V21 the voider existed ONLY inside the ORDER_VOIDED
        // event payload built 10 lines below — nothing could read it back, so "who voided this
        // order" had no answer on any screen. Same value, same source, now also on the row.
        order.setVoidedBy(tenantContext.getUserId().orElse(null));

        // Release table — terminal order status routes syncStatusForOrder to AVAILABLE.
        tableService.syncStatusForOrder(order.getTableId(), order.getBranchId(),
                order.getStatus(), order.getDerivedStatus());

        order = orderRepository.save(order);

        UUID voidedBy = tenantContext.getUserId().orElse(null);
        var payload = new PosVoidRefundPayloads.OrderVoidedPayload(orderId, request.reason(), voidedBy);
        eventPublisher.publish(POS_EXCHANGE, ORDER_VOIDED_KEY, ORDER_VOIDED_TYPE,
                order.getBranchId(), payload);

        OrderDto dto = orderMapper.toDto(order);
        idempotencyService.markComplete(idempotencyKey, dto.id().toString());
        return dto;
    }

    /**
     * POS-23 seam: closes {@code orderId} ONLY when it is fully Paid
     * ({@code paymentStatus == PAID}) AND fully Served ({@code derivedStatus == SERVED}), and
     * is not already terminal. Invoked from {@code PaymentServiceImpl.recordPayment} (a
     * payment that completes an already-served order) and {@code markItemServed} (serving the
     * last line of an already-paid order). A no-op (returns the order unchanged) when the
     * conditions are not met or the order is already CLOSED/VOIDED/REFUNDED — safe to call
     * from both mutation paths without risking a double-close or an illegal transition.
     */
    @Override
    public OrderDto maybeCloseOrder(UUID orderId) {
        UUID tenantId = tenantContext.requireTenantId();
        Order order = findOrderForTenant(orderId, tenantId);

        if (isTerminal(order.getStatus())) {
            return orderMapper.toDto(order);
        }

        long paidPaisa = orderPaymentRepository.sumAmountByOrderId(orderId);
        PaymentStatus paymentStatus = paymentStatusDerivationService.derive(
                paidPaisa, order.getTotalPaisa(), order.getStatus());

        boolean fullyPaidAndServed = paymentStatus == PaymentStatus.PAID
                && order.getDerivedStatus() == DerivedOrderStatus.SERVED;
        if (!fullyPaidAndServed) {
            return orderMapper.toDto(order);
        }

        List<PosEventContract.PaymentEntry> paymentEntries = orderPaymentRepository.findByOrderId(orderId).stream()
                // F20: the tip rides alongside the applied amount, never inside it. finance debits
                // amount + tip to the tender's account and credits the tip to a liability; folding
                // it into amountPaisa would both unbalance the entry (totalPaisa excludes it) and
                // book staff money as sales revenue.
                .map(p -> new PosEventContract.PaymentEntry(p.getMethod().name(), p.getAmountPaisa(),
                        p.getTipPaisa(), p.getTenderedPaisa(), p.getChangePaisa(), p.getReferenceNo()))
                .collect(Collectors.toList());

        Order closed = performClose(order, paymentEntries);
        return orderMapper.toDto(closed);
    }

    /**
     * Shared close side-effects (POS-23 single seam): period-lock check (fail-closed), the
     * CLOSED state transition, table release, persistence, and the ONE ORDER_CLOSED publish
     * in this class. As of plan 07.3-11 the legacy exact-tender-sum close bypass service
     * method is deleted (its HTTP endpoint now returns 410 Gone) —
     * {@code maybeCloseOrder}'s Paid-AND-Served path is the ONLY remaining caller.
     */
    private Order performClose(Order order, List<PosEventContract.PaymentEntry> paymentEntries) {
        UUID tenantId = order.getTenantId();

        // The business day is resolved from closedAt, not openedAt, and via the SHARED rule — the
        // same date is then checked against the accounting period AND stamped on ORDER_CLOSED, so
        // the period POS validates and the period finance posts into cannot disagree. An order
        // opened 23:00 and closed 00:30 used to be checked against yesterday and posted to today.
        //
        // S0-C: it is cut on THIS BRANCH'S wall clock, not on UTC. The UTC variant this line used
        // to call put the trading-day boundary at 09:00 local for Asia/Karachi instead of 04:00,
        // so every breakfast sale was period-checked against yesterday and — because finance
        // copies this exact date onto the journal entry — posted to yesterday's ledger too, while
        // the payment list, the till session and the order number all read today.
        Instant closedAt = Instant.now();
        LocalDate businessDate = branchBusinessDay.dateOf(closedAt, order.getBranchId());
        FinancePeriodClient.assertPeriodOpen(financePeriodClient, tenantId, order.getBranchId(), businessDate);

        stateMachine.assertTransition(order.getStatus(), OrderStatus.CLOSED);
        order.setStatus(OrderStatus.CLOSED);
        order.setClosedAt(closedAt);

        // Set table -> AVAILABLE — terminal order status routes syncStatusForOrder to AVAILABLE.
        tableService.syncStatusForOrder(order.getTableId(), order.getBranchId(),
                order.getStatus(), order.getDerivedStatus());

        order = orderRepository.save(order);

        List<PosEventContract.ItemEntry> itemEntries = order.getItems().stream()
                .map(item -> new PosEventContract.ItemEntry(
                        item.getMenuItemId(),
                        item.getItemNameSnapshot(),
                        item.getQuantity(),
                        item.getUnitPriceSnapshot(),
                        item.getLineTotalPaisa()))
                .collect(Collectors.toList());

        // B3: the discounts travel WITH the close, not as a later lookup. reporting's ETL is the
        // only consumer today and it writes them to their own fact table, which is what turns the
        // Discount Summary report from a column of daily totals into a list an owner can act on.
        Map<UUID, String> itemNamesById = order.getItems().stream()
                .collect(Collectors.toMap(OrderItem::getId, OrderItem::getItemNameSnapshot,
                        (a, b) -> a));
        List<PosEventContract.DiscountEntry> discountEntries = order.getDiscounts().stream()
                .map(d -> new PosEventContract.DiscountEntry(
                        d.getScope(),
                        d.getOrderItemId(),
                        d.getOrderItemId() == null ? null : itemNamesById.get(d.getOrderItemId()),
                        d.getType(),
                        d.getValue(),
                        d.getAmountPaisa(),
                        d.getReason(),
                        d.getAppliedBy(),
                        d.getAppliedByName()))
                .collect(Collectors.toList());

        Order finalOrder = order;
        var payload = new PosEventContract.OrderClosedPayload(
                finalOrder.getId(),
                finalOrder.getOrderNo(),
                finalOrder.getType().name(),
                finalOrder.getCustomerId(),
                finalOrder.getSubtotalPaisa(),
                finalOrder.getDiscountPaisa(),
                finalOrder.getServiceChargePaisa(),
                finalOrder.getTaxPaisa(),
                finalOrder.getTotalPaisa(),
                paymentEntries,
                itemEntries,
                finalOrder.getTillSessionId(),
                finalOrder.getCashierId(),
                discountEntries,
                closedAt,
                businessDate
        );

        eventPublisher.publish(POS_EXCHANGE, ORDER_CLOSED_KEY, ORDER_CLOSED_TYPE,
                finalOrder.getBranchId(), payload);

        // 26-07: the customer receipt, for a branch that has a receipt printer configured — so a
        // till set up for silent printing does not need the cashier to press anything. A branch
        // with no printer enqueues NOTHING (D-26-01: that tenant prints through the browser), and
        // the same after-commit reasoning as the fire seam applies here, only more so: this is the
        // single seam five downstream services consume.
        printDispatchService.dispatchReceiptAfterCommit(finalOrder.getId(), finalOrder.getBranchId());

        return finalOrder;
    }

    @Override
    public OrderDto markItemServed(UUID orderId, UUID itemId) {
        UUID tenantId = tenantContext.requireTenantId();
        Order order = findOrderForTenant(orderId, tenantId);
        OrderItem item = findItemInOrder(order, itemId);

        if (item.getItemStatus() == OrderItemStatus.PENDING) {
            throw new io.restaurantos.shared.exception.StateInvalidException(
                    "Cannot serve item that has not been fired to the kitchen: " + itemId);
        }
        if (item.getItemStatus() == OrderItemStatus.CANCELLED) {
            throw new io.restaurantos.shared.exception.StateInvalidException(
                    "Cannot serve a cancelled item: " + itemId);
        }

        item.setItemStatus(OrderItemStatus.SERVED);
        order.setDerivedStatus(orderStatusDerivationService.derive(order.getItems()));
        tableService.syncStatusForOrder(order.getTableId(), order.getBranchId(),
                order.getStatus(), order.getDerivedStatus());
        Order saved = orderRepository.save(order);
        OrderDto dto = orderMapper.toDto(saved);

        // Tell the KDS the line was served so it leaves the Ready column immediately, instead of
        // lingering there until the whole order closes (mirrors the ORDER_ITEM_CANCELLED path).
        // markItemServed rejects PENDING (never-fired) lines above, so a served line was always
        // fired to the kitchen — there is always a KDS line to update, hence no wasFired guard.
        publishItemServed(saved, tenantId, itemId);

        // POS-23: serving the last line of an already-fully-paid order closes it — the single
        // maybeCloseOrder seam is a no-op unless paymentStatus==PAID && derivedStatus==SERVED.
        if (order.getDerivedStatus() == DerivedOrderStatus.SERVED) {
            dto = maybeCloseOrder(orderId);
        }
        return dto;
    }

    /**
     * S0-06: the ONE operator-reachable step from "the guest has paid" to a terminal order.
     *
     * <p><b>Why this exists.</b> {@code maybeCloseOrder} closes only when the order is
     * {@code PAID} <i>and</i> {@code derivedStatus == SERVED}, and SERVED was reachable only by
     * pressing Mark Served on every line individually — controls that live on the terminal's
     * order panel and the order drawer, neither of which is on the path a cashier walks after
     * taking the money. The observable consequence was that the NORMAL end state of a settled
     * check was an open, still-voidable ticket sitting at {@code SENT_TO_KDS / PAID}.
     *
     * <p><b>What it does.</b> Serves every active (non-CANCELLED) line in ONE transaction,
     * publishing the same per-line {@code ORDER_ITEM_SERVED} the single-line path publishes so
     * the KDS clears identically, then delegates to {@code maybeCloseOrder}. It deliberately
     * does NOT close the order itself: {@code performClose} keeps exactly one caller, so the
     * Paid-AND-Served rule, the period-lock check and the single {@code ORDER_CLOSED} publish
     * cannot be bypassed by this path. An order that is served but not fully paid simply stays
     * open — which is the correct answer, not a failure.
     *
     * <p><b>Refusals</b> (409 {@code StateInvalidException}, deliberately loud rather than a
     * silent partial success — a control that appears to do nothing is the defect this closes):
     * <ul>
     *   <li>the order is VOIDED or REFUNDED — those are different end states, and asking to
     *       serve one is a real mistake worth naming;</li>
     *   <li>any active line is still PENDING — it was never fired, so it cannot have been
     *       served, and serving the rest would leave the order PARTIALLY_SERVED and open.</li>
     * </ul>
     *
     * <p><b>Already CLOSED is NOT a refusal.</b> CLOSED is precisely the state this operation
     * exists to reach, so arriving there twice — a double-tap, or a second terminal racing the
     * first — is success, and it returns the order unchanged. Throwing would paint a red error
     * under a button that had just done exactly what the cashier asked.
     */
    @Override
    public OrderDto markAllItemsServed(UUID orderId) {
        UUID tenantId = tenantContext.requireTenantId();
        Order order = findOrderForTenant(orderId, tenantId);

        if (order.getStatus() == OrderStatus.CLOSED) {
            return orderMapper.toDto(order);
        }
        if (isTerminal(order.getStatus())) {
            throw new io.restaurantos.shared.exception.StateInvalidException(
                    "Cannot serve an order that is already " + order.getStatus() + ": " + orderId);
        }

        List<OrderItem> active = order.getItems().stream()
                .filter(i -> i.getItemStatus() != OrderItemStatus.CANCELLED)
                .toList();

        if (active.isEmpty()) {
            throw new io.restaurantos.shared.exception.StateInvalidException(
                    "Cannot serve an order with no active items: " + orderId);
        }

        List<UUID> unfired = active.stream()
                .filter(i -> i.getItemStatus() == OrderItemStatus.PENDING)
                .map(OrderItem::getId)
                .toList();
        if (!unfired.isEmpty()) {
            throw new io.restaurantos.shared.exception.StateInvalidException(
                    "Cannot serve items that have not been fired to the kitchen: " + unfired);
        }

        List<UUID> newlyServed = new ArrayList<>();
        for (OrderItem item : active) {
            if (item.getItemStatus() != OrderItemStatus.SERVED) {
                item.setItemStatus(OrderItemStatus.SERVED);
                newlyServed.add(item.getId());
            }
        }

        order.setDerivedStatus(orderStatusDerivationService.derive(order.getItems()));
        tableService.syncStatusForOrder(order.getTableId(), order.getBranchId(),
                order.getStatus(), order.getDerivedStatus());
        Order saved = orderRepository.save(order);

        for (UUID servedItemId : newlyServed) {
            publishItemServed(saved, tenantId, servedItemId);
        }

        // Same seam, same rule as the single-line path — closing is a consequence of Paid AND
        // Served, never a direct instruction from the caller.
        return maybeCloseOrder(orderId);
    }

    /**
     * The one ORDER_ITEM_SERVED publish in this class — shared by the single-line
     * {@code markItemServed} and the whole-check {@code markAllItemsServed} so the KDS sees the
     * identical event either way, and a future change to the payload cannot drift between them.
     */
    private void publishItemServed(Order order, UUID tenantId, UUID itemId) {
        var servedPayload = new PosEventPayloads.OrderItemServedPayload(
                order.getId(), tenantId, order.getBranchId(), itemId);
        eventPublisher.publish(POS_EXCHANGE, ORDER_ITEM_SERVED_KEY, ORDER_ITEM_SERVED_TYPE,
                order.getBranchId(), servedPayload);
    }

    @Override
    public OrderDto cancelItem(UUID orderId, UUID itemId) {
        UUID tenantId = tenantContext.requireTenantId();
        Order order = findOrderForTenant(orderId, tenantId);
        OrderItem item = findItemInOrder(order, itemId);

        if (item.getItemStatus() == OrderItemStatus.SERVED) {
            throw new io.restaurantos.shared.exception.StateInvalidException(
                    "Cannot cancel an already-served item: " + itemId);
        }

        boolean wasFired = item.getItemStatus() != OrderItemStatus.PENDING;
        item.setItemStatus(OrderItemStatus.CANCELLED);
        // Recompute money fields so the cancelled line stops counting toward the amount due
        // (previously skipped — the total/payment never dropped, even across reload).
        recomputeOrderTotals(order);
        order.setDerivedStatus(orderStatusDerivationService.derive(order.getItems()));
        tableService.syncStatusForOrder(order.getTableId(), order.getBranchId(),
                order.getStatus(), order.getDerivedStatus());
        Order saved = orderRepository.save(order);

        // If the line had already been fired to the kitchen, tell the KDS so it can mark the
        // ticket item cancelled (struck through) instead of leaving a phantom item on the board.
        if (wasFired) {
            var payload = new PosEventPayloads.OrderItemCancelledPayload(
                    saved.getId(), tenantId, saved.getBranchId(), itemId);
            eventPublisher.publish(POS_EXCHANGE, ORDER_ITEM_CANCELLED_KEY, ORDER_ITEM_CANCELLED_TYPE,
                    saved.getBranchId(), payload);
        }
        return orderMapper.toDto(saved);
    }

    @Override
    public OrderDto updateInstructions(UUID orderId, UpdateInstructionsRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        Order order = findOrderForTenant(orderId, tenantId);

        if (isTerminal(order.getStatus())) {
            throw new io.restaurantos.shared.exception.StateInvalidException(
                    "Cannot edit instructions on order in status: " + order.getStatus());
        }

        // Server-side char-limit enforcement (RESEARCH.md Security Domain V5) — defense
        // in depth alongside the DTO's @Valid annotation, exercised even when this method
        // is invoked directly (bypassing the MVC layer, e.g. offline-sync replay / ITs).
        if (request.notes() != null && request.notes().length() > UpdateInstructionsRequest.ORDER_NOTES_MAX_LENGTH) {
            throw new IllegalArgumentException(
                    "Order notes must not exceed " + UpdateInstructionsRequest.ORDER_NOTES_MAX_LENGTH + " characters");
        }
        if (request.itemNotes() != null) {
            for (String notes : request.itemNotes().values()) {
                if (notes != null && notes.length() > UpdateInstructionsRequest.ITEM_NOTES_MAX_LENGTH) {
                    throw new IllegalArgumentException(
                            "Item notes must not exceed " + UpdateInstructionsRequest.ITEM_NOTES_MAX_LENGTH + " characters");
                }
            }
        }

        if (request.notes() != null) {
            order.setNotes(request.notes());
        }
        if (request.itemNotes() != null) {
            request.itemNotes().forEach((itemId, notes) -> {
                OrderItem item = findItemInOrder(order, itemId);
                item.setNotes(notes);
            });
        }

        return orderMapper.toDto(orderRepository.save(order));
    }

    @Override
    public OrderDto assignTable(UUID orderId, UUID tableId) {
        UUID tenantId = tenantContext.requireTenantId();
        Order order = findOrderForTenant(orderId, tenantId);

        if (isTerminal(order.getStatus())) {
            throw new io.restaurantos.shared.exception.StateInvalidException(
                    "Cannot assign a table to an order in status: " + order.getStatus());
        }

        DiningTable table = tableRepository.findByIdTenantAndBranch(tableId, tenantId, order.getBranchId())
                .orElseThrow(() -> new ResourceNotFoundException("Dining table not found: " + tableId));

        // A retired table is not assignable (19b-01). Checked here as well as filtered out of
        // the picker's list, because the list is a suggestion and this is the boundary — a
        // client holding a table id it fetched before the table was retired must be refused.
        if (!table.isActive()) {
            throw new io.restaurantos.shared.exception.StateInvalidException(
                    "Table is no longer in service: " + table.getTableNumber());
        }

        // Re-check AVAILABLE INSIDE the transaction (T-07.3-12 — concurrency-safe; a caller
        // cannot rely on a stale pre-fetched table list). OCCUPIED/NEEDS_BUSSING are rejected.
        if (table.getStatus() != io.restaurantos.pos.domain.enums.TableStatus.AVAILABLE) {
            throw new io.restaurantos.shared.exception.StateInvalidException(
                    "Table is not available: " + table.getStatus());
        }

        UUID previousTableId = order.getTableId();
        order.setTableId(tableId);
        order = orderRepository.save(order);

        // Single seam (RESEARCH.md Pitfall 5) — route BOTH the previous binding (a no-op when
        // null, the common case) and the newly-assigned table through syncStatusForOrder; never
        // an inline table.setStatus(...) call.
        tableService.syncStatusForOrder(previousTableId, order.getBranchId(), order.getStatus(), order.getDerivedStatus());
        tableService.syncStatusForOrder(tableId, order.getBranchId(), order.getStatus(), order.getDerivedStatus());

        return orderMapper.toDto(order);
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    private OrderItem findItemInOrder(Order order, UUID itemId) {
        return order.getItems().stream()
                .filter(i -> i.getId().equals(itemId))
                .findFirst()
                .orElseThrow(() -> new ResourceNotFoundException("Order item not found: " + itemId));
    }

    private Order findOrderForTenant(UUID orderId, UUID tenantId) {
        return orderRepository.findById(orderId)
                .filter(o -> tenantId.equals(o.getTenantId()))
                .orElseThrow(() -> new PosExceptions.OrderNotFoundException(orderId.toString()));
    }

    /**
     * Terminal (settlement) order statuses — no further item mutation or KDS fire is
     * permitted once an order reaches one of these. Kept as the single predicate shared by
     * {@code addItem} and {@code sendToKds} (RESEARCH.md Pitfall 6 — the two guards must be
     * symmetric, or items can be added but never fired).
     */
    private boolean isTerminal(OrderStatus status) {
        return status == OrderStatus.CLOSED || status == OrderStatus.VOIDED || status == OrderStatus.REFUNDED;
    }

    /**
     * A request fingerprint that fits {@code idempotency_keys.request_hash VARCHAR(64)} whatever
     * the operator typed — 64 hex characters, always (F2).
     *
     * <p>Deliberately NOT a substring of the reason: two voids whose reasons differ only after the
     * 64th character would then look like the same request, and the second one would be answered
     * with the first one's response instead of being performed. Truncation would have made the
     * crash go away and replaced it with a silent wrong answer on a money path.
     */
    private static String sha256Hex(String value) {
        try {
            byte[] digest = java.security.MessageDigest.getInstance("SHA-256")
                    .digest((value == null ? "" : value).getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(64);
            for (byte b : digest) {
                sb.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
            }
            return sb.toString();
        } catch (java.security.NoSuchAlgorithmException e) {
            // SHA-256 is mandatory in every JRE; this cannot happen and must not be swallowed.
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private OrderSummaryDto toSummaryDto(Order order, Map<UUID, String> tableNames, Map<UUID, Long> paidByOrderId) {
        long amountPaidPaisa = paidByOrderId.getOrDefault(order.getId(), 0L);
        PaymentStatus paymentStatus = paymentStatusDerivationService.derive(
                amountPaidPaisa, order.getTotalPaisa(), order.getStatus());

        int itemQuantity = 0;
        int distinctItemCount = 0;
        for (OrderItem item : order.getItems()) {
            if (item.getItemStatus() == OrderItemStatus.CANCELLED) {
                continue;
            }
            itemQuantity += item.getQuantity();
            distinctItemCount++;
        }

        return new OrderSummaryDto(
                order.getId(),
                order.getOrderNo(),
                order.getTableId(),
                order.getTableId() != null ? tableNames.get(order.getTableId()) : null,
                // F2: the row's own order type. Free — it is a column of the order already loaded
                // here. Without it the client had nothing to render but the table name, so it
                // guessed `tableName ?? "Takeaway"` and called every tableless DINE_IN check a
                // takeaway (measured: 10/10 rows on 2026-08-12).
                order.getType(),
                order.getDerivedStatus(),
                order.getCashierId(),
                order.getCoverCount(),
                order.getTotalPaisa(),
                order.getOpenedAt(),
                order.getStatus(),
                paymentStatus,
                amountPaidPaisa,
                itemQuantity,
                distinctItemCount
        );
    }

    /**
     * The order's four money fields, recomputed from its lines and its discount rows.
     *
     * <h2>B3 — a LINE-scope discount used to be worth nothing</h2>
     *
     * <p>This method summed exactly two things: {@code OrderItem.discountPaisa} (set at
     * add-item time, from the menu) and the {@code OrderDiscount} rows whose scope is
     * {@code "ORDER"}. A {@code LINE}-scope {@code OrderDiscount} — the row
     * {@link #applyDiscount} writes when a cashier takes 10% off one dish — matched neither, so
     * it was priced, persisted, returned in the response, and moved the bill by exactly zero
     * paisa. Structurally present, behaviourally absent, and invisible because a cashier who
     * cannot reach the control never sees the total fail to move.
     *
     * <p>Line-scope rows are now summed per item and capped at what is left of that line after
     * the menu-level discount — so no line can go below zero however many discounts land on it,
     * and a discount attached to a CANCELLED line contributes nothing (the line is not on the
     * bill, so neither is its discount).
     *
     * <p>Tax is deliberately NOT recomputed here. It is the per-line figure stamped at add-item
     * time, and the customer receipt asserts {@code Σ lineTax == order.taxPaisa} before it will
     * print. Re-basing tax on the discounted amount is a real question with a real answer, but it
     * is a change to what the ledger owes FBR and belongs with the tax work, not smuggled in
     * behind a discount button.
     *
     * <h2>F20 — the service charge is computed HERE, and nowhere else</h2>
     *
     * <p>{@code order.serviceChargePaisa} has existed since V1 and was read by DailyTakingsService,
     * by ORDER_CLOSED, by finance's revenue recipe and by the printed bill. Nothing ever assigned
     * it: measured live, it was 0 on all 195 orders in pos_db, while every screen dutifully printed
     * {@code Service charge Rs 0.00}. This is the assignment.
     *
     * <p>It is recomputed on every mutation rather than added once, because its base moves: adding
     * a dish, cancelling a line and taking a discount all change what the percentage is a
     * percentage OF. Doing it anywhere else — at close, at settle, in a separate endpoint — would
     * mean the cart's total and the charge screen's total could disagree, which is the one thing a
     * cashier holding a guest's money must never see.
     *
     * <p>The policy is read from pos-service's own {@code branch_service_charge} row inside this
     * transaction, never from user-service: {@code UserBranchClient} is deliberately fail-soft, and
     * a pricing input that can silently degrade to "no charge" during a network blip would produce
     * two different totals for two identical checks with nothing on screen saying why.
     */
    private void recomputeOrderTotals(Order order) {
        // LINE-scope discount rows, totalled per item id. Applied per line below so each one is
        // capped against its own line rather than against the order.
        Map<UUID, Long> lineScopeByItem = new HashMap<>();
        for (OrderDiscount d : order.getDiscounts()) {
            if (!"LINE".equals(d.getScope()) || d.getOrderItemId() == null) {
                continue;
            }
            lineScopeByItem.merge(d.getOrderItemId(), d.getAmountPaisa(), Long::sum);
        }

        long subtotal = 0L;
        long lineDiscounts = 0L;
        long tax = 0L;

        for (OrderItem item : order.getItems()) {
            // CANCELLED lines contribute nothing to the money owed — excluding them here is
            // what makes a cancel actually reduce subtotal/tax/total (and therefore the
            // amount due). Mirrors toSummaryDto's item-count exclusion.
            if (item.getItemStatus() == OrderItemStatus.CANCELLED) {
                continue;
            }
            // S6: through the calculator, NOT `unitPriceSnapshot * quantity` inline. This line
            // used to do its own arithmetic and left the modifier deltas out of it. That agreed
            // with the line's own `lineTotalPaisa` only for as long as every delta was the zero
            // the addItem stub wrote; the moment a modifier carried a real price the two diverged,
            // and the order header disagreed with its own lines — the screen, the printed bill and
            // the journal entry differing by the price of the extras on the same check.
            long itemSubtotal = pricingCalculator.lineSubtotal(item);
            long itemDiscount = item.getDiscountPaisa();
            // Whatever is left of this line after the menu-level discount is the most any
            // line-scope discount can take off it.
            long headroom = Math.max(0L, itemSubtotal - itemDiscount);
            itemDiscount += Math.min(lineScopeByItem.getOrDefault(item.getId(), 0L), headroom);

            subtotal += itemSubtotal;
            lineDiscounts += itemDiscount;
            tax += item.getTaxPaisa();
        }

        long orderLevelDiscount = order.getDiscounts().stream()
                .filter(d -> "ORDER".equals(d.getScope()))
                .mapToLong(OrderDiscount::getAmountPaisa)
                .sum();

        long totalDiscount = lineDiscounts + Math.min(orderLevelDiscount, subtotal - lineDiscounts);
        if (totalDiscount < 0) totalDiscount = 0L;

        applyServiceCharge(order, subtotal - totalDiscount);

        long total = Math.max(0L, subtotal - totalDiscount + tax + order.getServiceChargePaisa());

        order.setSubtotalPaisa(subtotal);
        order.setDiscountPaisa(totalDiscount);
        order.setTaxPaisa(tax);
        order.setTotalPaisa(total);
    }

    /**
     * Stamp the branch's service charge, its rate and its wording onto the order (F20).
     *
     * <p>Three fields move together or none of them do. A {@code serviceChargePaisa} with no
     * {@code serviceChargePct} beside it is an amount the bill cannot explain, and a rate with no
     * label is a percentage with nothing naming it — both were live defects on the tax side before
     * V23 snapshotted the same three facts onto the order line.
     *
     * <p><b>A branch with no policy, a disabled policy, or a policy that does not cover this
     * channel all land on the same place: zero, no rate, no label.</b> That is what makes the
     * receipt able to omit the line entirely rather than print {@code Rs 0.00}. It also means
     * switching the charge off is retroactive for OPEN checks the next time anything on them
     * changes, which is correct — an open check has not been presented yet, and a guest should not
     * be billed for a policy the restaurant has withdrawn.
     *
     * @param netBasePaisa subtotal less every discount, before tax. See
     *                     {@code OrderPricingCalculator.serviceCharge} for why that is the base
     */
    private void applyServiceCharge(Order order, long netBasePaisa) {
        BranchServiceCharge policy = serviceChargeService.policyFor(order.getBranchId())
                .filter(p -> p.appliesTo(order.getType()))
                .orElse(null);

        if (policy == null) {
            order.setServiceChargePaisa(0L);
            order.setServiceChargePct(BigDecimal.ZERO);
            order.setServiceChargeLabel(null);
            return;
        }

        order.setServiceChargePaisa(pricingCalculator.serviceCharge(netBasePaisa, policy.getRatePct()));
        order.setServiceChargePct(policy.getRatePct());
        order.setServiceChargeLabel(policy.getLabel());
    }

    /**
     * What is still discountable on one line: its menu price less every discount already on it.
     * A percentage is taken of this, never of {@code lineTotalPaisa} — that figure is
     * tax-INCLUSIVE, so "10% off" priced against it charged the guest 10% of the tax as well.
     */
    private long lineDiscountBase(Order order, OrderItem item) {
        long gross = item.getUnitPriceSnapshot() * item.getQuantity();
        long already = item.getDiscountPaisa() + order.getDiscounts().stream()
                .filter(d -> "LINE".equals(d.getScope()) && item.getId().equals(d.getOrderItemId()))
                .mapToLong(OrderDiscount::getAmountPaisa)
                .sum();
        return Math.max(0L, gross - already);
    }

    /**
     * What is still discountable on the whole check: the subtotal less every line discount and
     * every order-level discount already applied. Pricing an order-level percentage against the
     * gross subtotal while a line discount was already on the bill overstated it, and the
     * overstatement was then silently clipped by {@link #recomputeOrderTotals} — so the stored
     * {@code amount_paisa} disagreed with the money actually taken off, which is the figure the
     * Discount Summary report reads.
     */
    private long orderDiscountBase(Order order) {
        long subtotal = 0L;
        long lineDiscounts = 0L;
        for (OrderItem item : order.getItems()) {
            if (item.getItemStatus() == OrderItemStatus.CANCELLED) {
                continue;
            }
            long gross = item.getUnitPriceSnapshot() * item.getQuantity();
            long already = item.getDiscountPaisa() + order.getDiscounts().stream()
                    .filter(d -> "LINE".equals(d.getScope()) && item.getId().equals(d.getOrderItemId()))
                    .mapToLong(OrderDiscount::getAmountPaisa)
                    .sum();
            subtotal += gross;
            lineDiscounts += Math.min(already, gross);
        }
        long orderLevel = order.getDiscounts().stream()
                .filter(d -> "ORDER".equals(d.getScope()))
                .mapToLong(OrderDiscount::getAmountPaisa)
                .sum();
        return Math.max(0L, subtotal - lineDiscounts - orderLevel);
    }

    /**
     * The paisa this discount is worth, capped at what is still discountable.
     *
     * <p>{@code line} is the already-resolved order item for LINE scope, and null for ORDER
     * scope — resolved by the caller so a missing line is a 404 before any policy runs, not a
     * silent fall-through to pricing the whole check (which is what the old lookup did whenever
     * {@code orderItemId} was absent).
     *
     * <p>{@code value} is RUPEES for FLAT and PERCENT for PERCENT; the ×100 and the HALF_UP
     * rounding to whole paisa both happen here, once, through BigDecimal — never a float.
     */
    private long computeDiscountAmount(ApplyDiscountRequest request, Order order, OrderItem line) {
        long base = line != null ? lineDiscountBase(order, line) : orderDiscountBase(order);

        if ("FLAT".equals(request.type())) {
            long flat = request.value()
                    .multiply(BigDecimal.valueOf(100))
                    .setScale(0, java.math.RoundingMode.HALF_UP)
                    .longValue();
            return pricingCalculator.effectiveDiscount(flat, base);
        }
        // PERCENT
        long amount = request.value()
                .divide(BigDecimal.valueOf(100), 10, java.math.RoundingMode.HALF_UP)
                .multiply(BigDecimal.valueOf(base))
                .setScale(0, java.math.RoundingMode.HALF_UP)
                .longValue();
        return pricingCalculator.effectiveDiscount(amount, base);
    }

    /**
     * {@code ORD-YYYYMMDD-NNNN}, where {@code YYYYMMDD} is the TRADING DAY on the branch's own
     * clock — the same day the sale will appear under on Takings and in the ledger.
     *
     * <p>It used to be a bare {@code LocalDate.now()}: no zone, so the date on the face of the
     * ticket was the JVM host's calendar date (UTC in a container, the developer's zone on a
     * laptop) rather than the restaurant's; and no {@code −4h} offset, so the 01:00 orders of a
     * late service were numbered onto the next day while every other record filed them under the
     * night they belonged to. The column this keys, {@code order_sequences.business_date}, is
     * named for a rule it was not applying.
     *
     * <p>{@code LocalDate.now()} was also evaluated THREE times here — for the printed label, for
     * the row lookup and for the row it creates. A call that straddled the boundary could label an
     * order with one day and count it against another's sequence. It is resolved once now.
     */
    private String generateOrderNo(UUID tenantId, UUID branchId) {
        LocalDate businessDate = branchBusinessDay.currentDate(branchId);
        String label = businessDate.format(DateTimeFormatter.BASIC_ISO_DATE);
        OrderSequence seq = sequenceRepository.findForUpdate(tenantId, branchId, businessDate)
                .orElseGet(() -> {
                    OrderSequence newSeq = new OrderSequence();
                    newSeq.setTenantId(tenantId);
                    newSeq.setBranchId(branchId);
                    newSeq.setBusinessDate(businessDate);
                    newSeq.setLastSeq(0);
                    return newSeq;
                });
        seq.setLastSeq(seq.getLastSeq() + 1);
        sequenceRepository.save(seq);
        return String.format("ORD-%s-%04d", label, seq.getLastSeq());
    }
}
