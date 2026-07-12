package io.restaurantos.pos.service;

import io.restaurantos.pos.authz.PosAuthorizationService;
import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.OrderType;
import io.restaurantos.pos.domain.enums.TableStatus;
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
                            PosAuthorizationService posAuthorizationService) {
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
    }

    @Override
    public OrderDto createOrder(CreateOrderRequest request) {
        // Idempotent on clientOrderId
        Optional<Order> existing = orderRepository.findByClientOrderId(request.clientOrderId());
        if (existing.isPresent()) {
            return toDto(existing.get());
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

        order = orderRepository.save(order);
        return toDto(order);
    }

    @Override
    public OrderDto addItem(UUID orderId, AddOrderItemRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        Order order = findOrderForTenant(orderId, tenantId);

        // Only allow adding items to DRAFT or OPEN orders
        if (order.getStatus() != OrderStatus.DRAFT && order.getStatus() != OrderStatus.OPEN) {
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

            // Mark table as occupied
            if (order.getTableId() != null) {
                tableRepository.findByIdAndBranchId(order.getTableId(), order.getBranchId())
                        .ifPresent(table -> table.setStatus(TableStatus.OCCUPIED));
            }
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

        return toDto(order);
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
        return toDto(orderRepository.save(order));
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
        return toDto(orderRepository.save(order));
    }

    @Override
    public OrderDto sendToKds(UUID orderId) {
        UUID tenantId = tenantContext.requireTenantId();
        Order order = findOrderForTenant(orderId, tenantId);

        stateMachine.assertTransition(order.getStatus(), OrderStatus.SENT_TO_KDS);

        if (order.getItems().isEmpty()) {
            throw new PosExceptions.ZeroValueOrderException("Cannot send empty order to KDS");
        }

        order.setStatus(OrderStatus.SENT_TO_KDS);
        order.setSentToKdsAt(Instant.now());
        order = orderRepository.save(order);

        // Build KDS payload
        List<PosEventPayloads.KdsItemPayload> kdsItems = order.getItems().stream()
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
                kdsItems
        );
        eventPublisher.publish(POS_EXCHANGE, ORDER_SENT_TO_KDS_KEY, ORDER_SENT_TO_KDS_TYPE,
                order.getBranchId(), payload);

        return toDto(order);
    }

    @Override
    @Transactional(readOnly = true)
    public OrderDto getOrder(UUID orderId, UUID branchId) {
        Order order = orderRepository.findByIdAndBranchId(orderId, branchId)
                .orElseThrow(() -> new PosExceptions.OrderNotFoundException(orderId.toString()));
        return toDto(order);
    }

    @Override
    @Transactional(readOnly = true)
    public Page<OrderDto> listOrders(UUID branchId, List<String> statuses, Pageable pageable) {
        List<OrderStatus> statusEnums = statuses == null || statuses.isEmpty()
                ? List.of(OrderStatus.values())
                : statuses.stream().map(OrderStatus::valueOf).collect(Collectors.toList());
        return orderRepository.findByBranchIdAndStatusIn(branchId, statusEnums, pageable)
                .map(this::toDto);
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
            return toDto(order);
        }

        boolean claimed = idempotencyService.checkAndLock(idempotencyKey, request.reason(), 86400);
        if (!claimed) {
            Order order = orderRepository.findById(orderId)
                    .filter(o -> tenantId.equals(o.getTenantId()))
                    .orElseThrow(() -> new PosExceptions.OrderNotFoundException(orderId.toString()));
            return toDto(order);
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

        // Release table
        if (order.getTableId() != null) {
            tableRepository.findByIdAndBranchId(order.getTableId(), order.getBranchId())
                    .ifPresent(table -> table.setStatus(TableStatus.AVAILABLE));
        }

        order = orderRepository.save(order);

        UUID voidedBy = tenantContext.getUserId().orElse(null);
        var payload = new PosVoidRefundPayloads.OrderVoidedPayload(orderId, request.reason(), voidedBy);
        eventPublisher.publish(POS_EXCHANGE, ORDER_VOIDED_KEY, ORDER_VOIDED_TYPE,
                order.getBranchId(), payload);

        OrderDto dto = toDto(order);
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
            return toDto(order);
        }

        String requestHash = String.valueOf(request.hashCode());
        boolean claimed = idempotencyService.checkAndLock(idempotencyKey, requestHash, 86400);
        if (!claimed) {
            // Already in flight or completed — return current order state
            UUID tenantId = tenantContext.requireTenantId();
            Order order = orderRepository.findById(orderId)
                    .filter(o -> tenantId.equals(o.getTenantId()))
                    .orElseThrow(() -> new PosExceptions.OrderNotFoundException(orderId.toString()));
            return toDto(order);
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

        // 4. Period-lock check (fail-closed)
        LocalDate businessDate = order.getOpenedAt() != null
                ? order.getOpenedAt().atOffset(ZoneOffset.UTC).minusHours(4).toLocalDate()
                : LocalDate.now();
        FinancePeriodClient.assertPeriodOpen(financePeriodClient, tenantId, order.getBranchId(), businessDate);

        // 5. State transition
        stateMachine.assertTransition(order.getStatus(), OrderStatus.CLOSED);
        Instant closedAt = Instant.now();
        order.setStatus(OrderStatus.CLOSED);
        order.setClosedAt(closedAt);

        // Set table -> AVAILABLE
        if (order.getTableId() != null) {
            tableRepository.findByIdAndBranchId(order.getTableId(), order.getBranchId())
                    .ifPresent(table -> table.setStatus(TableStatus.AVAILABLE));
        }

        order = orderRepository.save(order);

        // 6. Publish ORDER_CLOSED event
        List<PosClosePayloads.PaymentEntry> paymentEntries = request.payments().stream()
                .map(p -> new PosClosePayloads.PaymentEntry(p.method(), p.amountPaisa(), p.referenceNo()))
                .collect(Collectors.toList());

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

        // 7. Mark idempotency complete
        OrderDto dto = toDto(finalOrder);
        idempotencyService.markComplete(idempotencyKey, dto.id().toString());

        return dto;
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    private Order findOrderForTenant(UUID orderId, UUID tenantId) {
        return orderRepository.findById(orderId)
                .filter(o -> tenantId.equals(o.getTenantId()))
                .orElseThrow(() -> new PosExceptions.OrderNotFoundException(orderId.toString()));
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

    private OrderDto toDto(Order order) {
        List<OrderDto.OrderItemDto> itemDtos = order.getItems().stream()
                .map(item -> new OrderDto.OrderItemDto(
                        item.getId(),
                        item.getMenuItemId(),
                        item.getItemNameSnapshot(),
                        item.getUnitPriceSnapshot(),
                        item.getQuantity(),
                        item.getKdsStation(),
                        item.getKdsStatus(),
                        item.getDiscountPaisa(),
                        item.getTaxPaisa(),
                        item.getLineTotalPaisa(),
                        item.getNotes(),
                        item.getModifiers().stream()
                                .map(m -> new OrderDto.ModifierDto(
                                        m.getId(),
                                        m.getModifierId(),
                                        m.getModifierNameSnapshot(),
                                        m.getPriceDeltaPaisa()))
                                .collect(Collectors.toList())
                ))
                .collect(Collectors.toList());

        return new OrderDto(
                order.getId(),
                order.getBranchId(),
                order.getOrderNo(),
                order.getType(),
                order.getStatus(),
                order.getTableId(),
                order.getCoverCount(),
                order.getCashierId(),
                order.getCustomerId(),
                order.getSubtotalPaisa(),
                order.getTaxPaisa(),
                order.getDiscountPaisa(),
                order.getServiceChargePaisa(),
                order.getTotalPaisa(),
                order.getNotes(),
                order.getOpenedAt(),
                order.getSentToKdsAt(),
                order.getClientOrderId(),
                order.getVersion(),
                itemDtos
        );
    }
}
