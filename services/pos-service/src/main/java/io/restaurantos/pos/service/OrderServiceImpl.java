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
import io.restaurantos.pos.event.PosClosePayloads;
import io.restaurantos.pos.event.PosEventPayloads;
import io.restaurantos.pos.event.PosVoidRefundPayloads;
import io.restaurantos.pos.exception.PosExceptions;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.repository.*;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.exception.PeriodLockedException;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.idempotency.IdempotencyService;
import io.restaurantos.shared.tenant.TenantContext;
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
    private static final String DEFAULT_KDS_STATION = "DEFAULT";
    private static final String VIEW_ALL_PERMISSION = "pos.order.view.all";

    private final OrderRepository orderRepository;
    private final OrderSequenceRepository sequenceRepository;
    private final MenuItemRepository menuItemRepository;
    private final BranchMenuOverrideRepository overrideRepository;
    private final DiningTableRepository tableRepository;
    private final OrderPaymentRepository orderPaymentRepository;
    private final OrderPricingCalculator pricingCalculator;
    private final OrderStateMachine stateMachine;
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
                            BranchMenuOverrideRepository overrideRepository,
                            DiningTableRepository tableRepository,
                            OrderPaymentRepository orderPaymentRepository,
                            OrderPricingCalculator pricingCalculator,
                            OrderStateMachine stateMachine,
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
                            OrderMapper orderMapper) {
        this.orderRepository = orderRepository;
        this.sequenceRepository = sequenceRepository;
        this.menuItemRepository = menuItemRepository;
        this.overrideRepository = overrideRepository;
        this.tableRepository = tableRepository;
        this.orderPaymentRepository = orderPaymentRepository;
        this.pricingCalculator = pricingCalculator;
        this.stateMachine = stateMachine;
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
    }

    // tableRepository is retained solely for listOrderSummaries' table-name lookup
    // (findByBranchId) — all table STATUS mutation now routes exclusively through
    // TableService.syncStatusForOrder (single derivation seam, RESEARCH.md Pitfall 5).

    @Override
    public OrderDto createOrder(CreateOrderRequest request) {
        // Idempotent on clientOrderId
        Optional<Order> existing = orderRepository.findByClientOrderId(request.clientOrderId());
        if (existing.isPresent()) {
            return orderMapper.toDto(existing.get());
        }

        UUID tenantId = tenantContext.requireTenantId();

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
            order.setTableId(request.tableId());
        }

        Order newOrder = order;
        tenantContext.getUserId().ifPresent(userId -> {
            newOrder.setCashierId(userId);
            tillSessionRepository.findByCashierIdAndStatus(userId, TillStatus.OPEN)
                    .ifPresent(till -> newOrder.setTillSessionId(till.getId()));
        });

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

        MenuItem menuItem = menuItemRepository.findById(request.menuItemId())
                .orElseThrow(() -> new ResourceNotFoundException("Menu item not found: " + request.menuItemId()));

        Optional<BranchMenuOverride> override = overrideRepository
                .findByBranchIdAndMenuItemId(request.branchId(), request.menuItemId());

        long unitPrice = pricingCalculator.effectiveUnitPrice(menuItem, override.orElse(null));

        OrderItem item = new OrderItem();
        item.setTenantId(tenantId);
        item.setOrder(order);
        item.setMenuItemId(menuItem.getId());
        item.setItemNameSnapshot(menuItem.getName());
        item.setUnitPriceSnapshot(unitPrice);
        item.setQuantity(request.quantity());
        item.setKdsStation(menuItem.getKdsStation());
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
    public OrderDto applyDiscount(UUID orderId, ApplyDiscountRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        Order order = findOrderForTenant(orderId, tenantId);

        if (order.getStatus() != OrderStatus.OPEN) {
            throw new io.restaurantos.shared.exception.StateInvalidException(
                    "Cannot apply discount to order in status: " + order.getStatus());
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

        // Build KDS payload from ONLY the newly-fired lines.
        List<PosEventPayloads.KdsItemPayload> kdsItems = newItems.stream()
                .map(item -> new PosEventPayloads.KdsItemPayload(
                        item.getId(),
                        item.getMenuItemId(),
                        item.getItemNameSnapshot(),
                        item.getQuantity(),
                        item.getKdsStation() != null ? item.getKdsStation() : DEFAULT_KDS_STATION,
                        item.getModifiers().stream()
                                .map(OrderItemModifier::getModifierNameSnapshot)
                                .collect(Collectors.toList()),
                        item.getNotes()
                ))
                .collect(Collectors.toList());

        var payload = new PosEventPayloads.OrderSentToKdsPayload(
                order.getId(),
                tenantId,
                order.getBranchId(),
                order.getOrderNo(),
                kdsItems,
                nextRevision,
                order.getNotes()
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
        Order order = orderRepository.findByIdAndBranchId(orderId, branchId)
                .orElseThrow(() -> new PosExceptions.OrderNotFoundException(orderId.toString()));
        return orderMapper.toDto(order);
    }

    @Override
    @Transactional(readOnly = true)
    public Page<OrderDto> listOrders(UUID branchId, List<String> statuses, Pageable pageable) {
        List<OrderStatus> statusEnums = statuses == null || statuses.isEmpty()
                ? List.of(OrderStatus.values())
                : statuses.stream().map(OrderStatus::valueOf).collect(Collectors.toList());
        return orderRepository.findByBranchIdAndStatusIn(branchId, statusEnums, pageable)
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

        Map<UUID, String> tableNames = tableRepository.findByBranchId(branchId).stream()
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

    @Override
    public OrderDto closeOrder(UUID orderId, CloseOrderRequest request, String idempotencyKey) {
        // 1. Idempotency check — return stored result if already completed
        Optional<String> stored = idempotencyService.getCompletedResponse(idempotencyKey);
        if (stored.isPresent()) {
            // Reconstruct DTO from stored JSON — for simplicity reload from DB
            UUID tenantId = tenantContext.requireTenantId();
            Order order = orderRepository.findById(orderId)
                    .filter(o -> tenantId.equals(o.getTenantId()))
                    .orElseThrow(() -> new PosExceptions.OrderNotFoundException(orderId.toString()));
            return orderMapper.toDto(order);
        }

        String requestHash = String.valueOf(request.hashCode());
        boolean claimed = idempotencyService.checkAndLock(idempotencyKey, requestHash, 86400);
        if (!claimed) {
            // Already in flight or completed — return current order state
            UUID tenantId = tenantContext.requireTenantId();
            Order order = orderRepository.findById(orderId)
                    .filter(o -> tenantId.equals(o.getTenantId()))
                    .orElseThrow(() -> new PosExceptions.OrderNotFoundException(orderId.toString()));
            return orderMapper.toDto(order);
        }

        UUID tenantId = tenantContext.requireTenantId();
        Order order = orderRepository.findById(orderId)
                .filter(o -> tenantId.equals(o.getTenantId()))
                .orElseThrow(() -> new PosExceptions.OrderNotFoundException(orderId.toString()));

        // 2. Validate order has items and non-zero total
        if (order.getItems().isEmpty() || order.getTotalPaisa() == 0) {
            throw new PosExceptions.ZeroValueOrderException("Cannot close empty or zero-value order: " + orderId);
        }

        // 3. Validate payment sum == order total
        splitTenderCalculator.validateExact(request.payments(), order.getTotalPaisa());

        // 4-6. Period-lock check, state transition, table sync, ORDER_CLOSED publish — routed
        // through the single close seam (POS-23) shared with maybeCloseOrder, so the publish
        // call exists exactly ONCE in this class (see performClose below).
        List<PosClosePayloads.PaymentEntry> paymentEntries = request.payments().stream()
                .map(p -> new PosClosePayloads.PaymentEntry(p.method(), p.amountPaisa(), p.referenceNo()))
                .collect(Collectors.toList());
        Order finalOrder = performClose(order, paymentEntries);

        // 7. Mark idempotency complete
        OrderDto dto = orderMapper.toDto(finalOrder);
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

        List<PosClosePayloads.PaymentEntry> paymentEntries = orderPaymentRepository.findByOrderId(orderId).stream()
                .map(p -> new PosClosePayloads.PaymentEntry(p.getMethod().name(), p.getAmountPaisa(), p.getReferenceNo()))
                .collect(Collectors.toList());

        Order closed = performClose(order, paymentEntries);
        return orderMapper.toDto(closed);
    }

    /**
     * Shared close side-effects (POS-23 single seam): period-lock check (fail-closed), the
     * CLOSED state transition, table release, persistence, and the ONE ORDER_CLOSED publish
     * in this class. Callers ({@code closeOrder}'s legacy exact-tender path and
     * {@code maybeCloseOrder}'s Paid-AND-Served path) differ only in how {@code paymentEntries}
     * is sourced — the close mechanics themselves must never diverge (RESEARCH.md Pitfall:
     * divergent close paths).
     */
    private Order performClose(Order order, List<PosClosePayloads.PaymentEntry> paymentEntries) {
        UUID tenantId = order.getTenantId();

        LocalDate businessDate = order.getOpenedAt() != null
                ? order.getOpenedAt().atOffset(ZoneOffset.UTC).minusHours(4).toLocalDate()
                : LocalDate.now();
        FinancePeriodClient.assertPeriodOpen(financePeriodClient, tenantId, order.getBranchId(), businessDate);

        stateMachine.assertTransition(order.getStatus(), OrderStatus.CLOSED);
        Instant closedAt = Instant.now();
        order.setStatus(OrderStatus.CLOSED);
        order.setClosedAt(closedAt);

        // Set table -> AVAILABLE — terminal order status routes syncStatusForOrder to AVAILABLE.
        tableService.syncStatusForOrder(order.getTableId(), order.getBranchId(),
                order.getStatus(), order.getDerivedStatus());

        order = orderRepository.save(order);

        List<PosClosePayloads.ItemEntry> itemEntries = order.getItems().stream()
                .map(item -> new PosClosePayloads.ItemEntry(
                        item.getMenuItemId(),
                        item.getItemNameSnapshot(),
                        item.getQuantity(),
                        item.getUnitPriceSnapshot(),
                        item.getLineTotalPaisa()))
                .collect(Collectors.toList());

        Order finalOrder = order;
        var payload = new PosClosePayloads.OrderClosedPayload(
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
                closedAt
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
        OrderDto dto = orderMapper.toDto(orderRepository.save(order));

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

        item.setItemStatus(OrderItemStatus.CANCELLED);
        order.setDerivedStatus(orderStatusDerivationService.derive(order.getItems()));
        tableService.syncStatusForOrder(order.getTableId(), order.getBranchId(),
                order.getStatus(), order.getDerivedStatus());
        return orderMapper.toDto(orderRepository.save(order));
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
