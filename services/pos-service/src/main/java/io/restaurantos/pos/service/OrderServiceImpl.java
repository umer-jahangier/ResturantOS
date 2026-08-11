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
import io.restaurantos.pos.feign.CrmPromotionClient;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.repository.*;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.exception.PeriodLockedException;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.idempotency.IdempotencyService;
import io.restaurantos.shared.tenant.TenantContext;
import io.restaurantos.shared.time.BusinessDay;
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
    private final BranchMenuOverrideRepository overrideRepository;
    private final DiningTableRepository tableRepository;
    private final OrderPaymentRepository orderPaymentRepository;
    private final OrderPricingCalculator pricingCalculator;
    private final OrderStateMachine stateMachine;
    private final CrmPromotionClient crmPromotionClient;
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
                            StationRoutingResolver stationRoutingResolver) {
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

        // Add modifiers if requested
        List<Long> modifierDeltas = new ArrayList<>();
        if (request.modifierIds() != null) {
            for (UUID modifierId : request.modifierIds()) {
                // Load modifier from item's groups — for simplicity use a direct lookup
                // We store snapshot data so we need the modifier entity
                OrderItemModifier oim = new OrderItemModifier();
                oim.setTenantId(tenantId);
                oim.setOrderItem(item);
                oim.setModifierId(modifierId);
                oim.setModifierNameSnapshot(modifierId.toString());
                oim.setPriceDeltaPaisa(0L);
                item.getModifiers().add(oim);
                modifierDeltas.add(0L);
            }
        }

        // Compute line pricing
        var lineResult = pricingCalculator.computeItemLine(
                unitPrice,
                modifierDeltas,
                request.quantity(),
                0L,
                menuItem.getTaxRatePct());

        item.setDiscountPaisa(lineResult.discountPaisa());
        item.setTaxPaisa(lineResult.taxPaisa());
        item.setLineTotalPaisa(lineResult.lineTotalPaisa());

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
        order.getDiscounts().add(discount);

        recomputeOrderTotals(order);
        return orderMapper.toDto(orderRepository.save(order));
    }

    @Override
    public OrderDto applyDiscount(UUID orderId, ApplyDiscountRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        Order order = findOrderForTenant(orderId, tenantId);

        if (order.getStatus() != OrderStatus.OPEN) {
            throw new io.restaurantos.shared.exception.StateInvalidException(
                    "Cannot apply discount to order in status: " + order.getStatus());
        }

        // pos.rego's pos.order.discount.override rule. Scoped to whole-order discounts — see
        // PosAuthorizationService.authorizeDiscountOverride for why a line discount is not gated
        // by it (doing so would refuse cashiers a discount they can legitimately apply today).
        if ("ORDER".equals(request.scope())) {
            posAuthorizationService.authorizeDiscountOverride(
                    orderId, tenantId, order.getBranchId(),
                    order.getCashierId(), order.getStatus().name());
        }

        long amountPaisa = computeDiscountAmount(request, order);

        OrderDiscount discount = new OrderDiscount();
        discount.setTenantId(tenantId);
        discount.setOrder(order);
        discount.setScope(request.scope());
        discount.setType(request.type());
        discount.setValue(request.value());
        discount.setAmountPaisa(amountPaisa);
        discount.setOrderItemId(request.orderItemId());
        discount.setAppliedBy(tenantContext.getUserId().orElse(null));
        order.getDiscounts().add(discount);

        recomputeOrderTotals(order);
        return orderMapper.toDto(orderRepository.save(order));
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
    public Page<OrderSummaryDto> listOrderSummaries(UUID branchId, List<String> statuses, Pageable pageable) {
        // branchId is a request parameter (matches the rest of this controller's existing
        // convention), but it must never widen scope beyond the caller's verified JWT branch
        // (T-07.1d-01 — a client-supplied branchId could otherwise leak cross-branch orders).
        UUID jwtBranchId = tenantContext.getBranchId()
                .orElseThrow(() -> new PermissionDeniedException("Branch context required"));
        if (!jwtBranchId.equals(branchId)) {
            throw new PermissionDeniedException("Cannot list orders for a different branch");
        }

        // Default (no explicit status filter) = ALL non-terminal statuses EXCLUDING DRAFT
        // (POS-16: a client-only cart never persists a DB order, so DRAFT rows are stale
        // abandoned carts, not active orders — they must never surface in Order Management).
        // A caller can still explicitly request DRAFT or a terminal status (e.g. [CLOSED])
        // via the statuses param; only the empty-filter DEFAULT excludes them.
        List<OrderStatus> statusEnums = (statuses == null || statuses.isEmpty())
                ? Arrays.stream(OrderStatus.values())
                        .filter(s -> !isTerminal(s) && s != OrderStatus.DRAFT)
                        .collect(Collectors.toList())
                : statuses.stream().map(OrderStatus::valueOf).collect(Collectors.toList());

        // Own-vs-all-branch visibility (SECURITY — T-07.1d-01): silently scope to the
        // caller's own orders unless they hold the all-branch view permission. Never a
        // client-controllable filter.
        Page<Order> orders = posAuthorizationService.hasPermission(VIEW_ALL_PERMISSION)
                ? orderRepository.findByBranchIdAndStatusIn(branchId, statusEnums, pageable)
                : orderRepository.findByBranchIdAndStatusInAndCashierId(
                        branchId, statusEnums, tenantContext.getUserId().orElse(null), pageable);

        // ALL tables, not just active ones — an order placed at a table that has since been
        // retired must still show its name in the order list, or the row reads "—" and the
        // manager cannot tell which table the money came from.
        Map<UUID, String> tableNames = tableRepository
                .findAllByTenantAndBranch(tenantContext.requireTenantId(), branchId).stream()
                .collect(Collectors.toMap(DiningTable::getId, DiningTable::getTableNumber));

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

    @Override
    public OrderDto voidOrder(UUID orderId, VoidOrderRequest request, String idempotencyKey) {
        // Idempotency: return early if already completed
        Optional<String> stored = idempotencyService.getCompletedResponse(idempotencyKey);
        UUID tenantId = tenantContext.requireTenantId();
        if (stored.isPresent()) {
            Order order = orderRepository.findById(orderId)
                    .filter(o -> tenantId.equals(o.getTenantId()))
                    .orElseThrow(() -> new PosExceptions.OrderNotFoundException(orderId.toString()));
            return orderMapper.toDto(order);
        }

        boolean claimed = idempotencyService.checkAndLock(idempotencyKey, request.reason(), 86400);
        if (!claimed) {
            Order order = orderRepository.findById(orderId)
                    .filter(o -> tenantId.equals(o.getTenantId()))
                    .orElseThrow(() -> new PosExceptions.OrderNotFoundException(orderId.toString()));
            return orderMapper.toDto(order);
        }

        Order order = orderRepository.findById(orderId)
                .filter(o -> tenantId.equals(o.getTenantId()))
                .orElseThrow(() -> new PosExceptions.OrderNotFoundException(orderId.toString()));

        // OPA authorization: void.own if creator+OPEN, void.any otherwise
        posAuthorizationService.authorizeVoid(
                orderId, tenantId, order.getBranchId(),
                order.getCashierId(), order.getStatus().name());

        stateMachine.assertTransition(order.getStatus(), OrderStatus.VOIDED);
        order.setStatus(OrderStatus.VOIDED);
        order.setVoidReason(request.reason());
        order.setVoidedAt(Instant.now());

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
                .map(p -> new PosEventContract.PaymentEntry(p.getMethod().name(), p.getAmountPaisa(),
                        p.getTenderedPaisa(), p.getChangePaisa(), p.getReferenceNo()))
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
        Instant closedAt = Instant.now();
        LocalDate businessDate = BusinessDay.of(closedAt);
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
                closedAt,
                businessDate
        );

        eventPublisher.publish(POS_EXCHANGE, ORDER_CLOSED_KEY, ORDER_CLOSED_TYPE,
                finalOrder.getBranchId(), payload);

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
        var servedPayload = new PosEventPayloads.OrderItemServedPayload(
                saved.getId(), tenantId, saved.getBranchId(), itemId);
        eventPublisher.publish(POS_EXCHANGE, ORDER_ITEM_SERVED_KEY, ORDER_ITEM_SERVED_TYPE,
                saved.getBranchId(), servedPayload);

        // POS-23: serving the last line of an already-fully-paid order closes it — the single
        // maybeCloseOrder seam is a no-op unless paymentStatus==PAID && derivedStatus==SERVED.
        if (order.getDerivedStatus() == DerivedOrderStatus.SERVED) {
            dto = maybeCloseOrder(orderId);
        }
        return dto;
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

    private void recomputeOrderTotals(Order order) {
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
            long itemSubtotal = item.getUnitPriceSnapshot() * item.getQuantity();
            subtotal += itemSubtotal;
            lineDiscounts += item.getDiscountPaisa();
            tax += item.getTaxPaisa();
        }

        long orderLevelDiscount = order.getDiscounts().stream()
                .filter(d -> "ORDER".equals(d.getScope()))
                .mapToLong(OrderDiscount::getAmountPaisa)
                .sum();

        long totalDiscount = lineDiscounts + Math.min(orderLevelDiscount, subtotal - lineDiscounts);
        if (totalDiscount < 0) totalDiscount = 0L;

        long total = Math.max(0L, subtotal - totalDiscount + tax + order.getServiceChargePaisa());

        order.setSubtotalPaisa(subtotal);
        order.setDiscountPaisa(totalDiscount);
        order.setTaxPaisa(tax);
        order.setTotalPaisa(total);
    }

    private long computeDiscountAmount(ApplyDiscountRequest request, Order order) {
        if ("FLAT".equals(request.type())) {
            long flat = request.value().multiply(BigDecimal.valueOf(100)).longValue();
            if ("LINE".equals(request.scope()) && request.orderItemId() != null) {
                OrderItem lineItem = order.getItems().stream()
                        .filter(i -> i.getId().equals(request.orderItemId()))
                        .findFirst()
                        .orElseThrow(() -> new ResourceNotFoundException(
                                "Order item not found: " + request.orderItemId()));
                return pricingCalculator.effectiveDiscount(flat, lineItem.getLineTotalPaisa());
            }
            return pricingCalculator.effectiveDiscount(flat, order.getSubtotalPaisa());
        }
        // PERCENT
        long base = "LINE".equals(request.scope()) && request.orderItemId() != null
                ? order.getItems().stream()
                        .filter(i -> i.getId().equals(request.orderItemId()))
                        .mapToLong(OrderItem::getLineTotalPaisa)
                        .findFirst()
                        .orElse(0L)
                : order.getSubtotalPaisa();
        long amount = request.value()
                .divide(BigDecimal.valueOf(100), 10, java.math.RoundingMode.HALF_UP)
                .multiply(BigDecimal.valueOf(base))
                .setScale(0, java.math.RoundingMode.HALF_UP)
                .longValue();
        return pricingCalculator.effectiveDiscount(amount, base);
    }

    private String generateOrderNo(UUID tenantId, UUID branchId) {
        String today = LocalDate.now().format(DateTimeFormatter.BASIC_ISO_DATE);
        OrderSequence seq = sequenceRepository.findForUpdate(tenantId, branchId, LocalDate.now())
                .orElseGet(() -> {
                    OrderSequence newSeq = new OrderSequence();
                    newSeq.setTenantId(tenantId);
                    newSeq.setBranchId(branchId);
                    newSeq.setBusinessDate(LocalDate.now());
                    newSeq.setLastSeq(0);
                    return newSeq;
                });
        seq.setLastSeq(seq.getLastSeq() + 1);
        sequenceRepository.save(seq);
        return String.format("ORD-%s-%04d", today, seq.getLastSeq());
    }
}
