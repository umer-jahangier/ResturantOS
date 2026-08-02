package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.domain.enums.TillStatus;
import io.restaurantos.pos.domain.model.Order;
import io.restaurantos.pos.domain.model.OrderPayment;
import io.restaurantos.pos.dto.OrderPaymentDto;
import io.restaurantos.pos.exception.PosExceptions;
import io.restaurantos.pos.feign.FinanceArClient;
import io.restaurantos.pos.repository.OrderPaymentRepository;
import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.pos.repository.TillSessionRepository;
import io.restaurantos.shared.exception.StateInvalidException;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@Transactional
public class PaymentServiceImpl implements PaymentService {

    private final OrderRepository orderRepository;
    private final OrderPaymentRepository paymentRepository;
    private final TenantContext tenantContext;
    private final OrderService orderService;
    private final TillSessionRepository tillSessionRepository;
    private final FinanceArClient financeArClient;

    public PaymentServiceImpl(OrderRepository orderRepository,
                              OrderPaymentRepository paymentRepository,
                              TenantContext tenantContext,
                              OrderService orderService,
                              TillSessionRepository tillSessionRepository,
                              FinanceArClient financeArClient) {
        this.orderRepository = orderRepository;
        this.paymentRepository = paymentRepository;
        this.tenantContext = tenantContext;
        this.orderService = orderService;
        this.tillSessionRepository = tillSessionRepository;
        this.financeArClient = financeArClient;
    }

    @Override
    public long recordPayment(UUID orderId, PaymentMethod method, long amountPaisa, Long tenderedPaisa,
                              String referenceNo, UUID customerAccountId) {
        UUID tenantId = tenantContext.requireTenantId();

        Order order = orderRepository.findById(orderId)
                .filter(o -> tenantId.equals(o.getTenantId()))
                .orElseThrow(() -> new PosExceptions.OrderNotFoundException(orderId.toString()));

        // Cannot record payment against terminal orders
        if (order.getStatus() == OrderStatus.CLOSED
                || order.getStatus() == OrderStatus.VOIDED
                || order.getStatus() == OrderStatus.REFUNDED) {
            throw new StateInvalidException(
                    "Cannot record payment for order in status: " + order.getStatus());
        }

        if (amountPaisa <= 0) {
            throw new IllegalArgumentException("Payment amount must be positive: " + amountPaisa);
        }

        // Guarantee the order is linked to the paying cashier's OPEN till (POS-till reconcil).
        // tillSessionId is otherwise only set at create-time, and only if the cashier already
        // had an open till THEN — so an order created before opening the till (or by another
        // path) stayed unlinked and its CASH payment was invisible to the till's expected
        // closing (the "charged but till shows 0" bug). Backfill it here, at settlement time.
        if (order.getTillSessionId() == null) {
            tenantContext.getUserId()
                    .flatMap(userId -> tillSessionRepository.findByCashierIdAndStatus(userId, TillStatus.OPEN))
                    .ifPresent(till -> order.setTillSessionId(till.getId()));
            if (order.getTillSessionId() != null) {
                orderRepository.save(order);
            }
        }

        // ── Cap the applied amount at what is actually owed ──────────────────────────────
        // ORDER_CLOSED carries the APPLIED amounts and finance debits their sum against credits
        // of subtotal - discount + tax + serviceCharge. Applying more than the bill therefore
        // makes the revenue journal entry unbalanceable, the deferred trigger rejects it, and the
        // consumer spins on the redelivered message forever while the order sits CLOSED with no
        // revenue posted. Over-tender is a cash-drawer fact, not a ledger fact.
        long alreadyApplied = paymentRepository.sumAmountByOrderId(orderId);
        long outstanding = order.getTotalPaisa() - alreadyApplied;
        if (outstanding <= 0) {
            throw new PosExceptions.OrderAlreadyPaidException(orderId.toString());
        }

        long applied = Math.min(amountPaisa, outstanding);
        if (applied < amountPaisa && method != PaymentMethod.CASH) {
            // A card/bank/voucher tender for more than the balance is an input error. There is no
            // drawer to give change from, so silently applying less would leave the operator
            // believing they charged the full amount.
            throw new PosExceptions.PaymentExceedsBalanceException(method.name(), amountPaisa, outstanding);
        }

        // Tender defaults to the requested amount; it can never be less than what was applied.
        long tendered = Math.max(tenderedPaisa != null ? tenderedPaisa : amountPaisa, applied);
        long change = tendered - applied;

        // CHARGE_TO_ACCOUNT is the one tender whose validity is decided outside pos-service: the
        // receivable and its balanced journal entry (DR 1200 / CR revenue) are finance's to create.
        // Call the seam FIRST and let a refusal propagate — persisting the payment before knowing
        // the charge was accepted would close the order against a declined tender.
        //
        // finance is idempotent on (tenantId, POS_ORDER, orderId), so a retry after a timeout
        // cannot double-charge the account.
        if (method == PaymentMethod.CHARGE_TO_ACCOUNT) {
            chargeToAccount(order, customerAccountId, applied);
        }

        OrderPayment payment = new OrderPayment();
        payment.setTenantId(tenantId);
        payment.setOrderId(orderId);
        payment.setMethod(method);
        payment.setAmountPaisa(applied);
        payment.setTenderedPaisa(tendered);
        payment.setChangePaisa(change);
        payment.setReferenceNo(referenceNo);
        payment.setRecordedAt(Instant.now());
        paymentRepository.save(payment);

        // POS-23: recording a payment persists it and derives paymentStatus, but never closes
        // the order directly — maybeCloseOrder is the single seam that closes ONLY when the
        // order is fully Paid AND fully Served (a payment on an unserved order stays open).
        orderService.maybeCloseOrder(orderId);

        return paymentRepository.sumAmountByOrderId(orderId);
    }

    /**
     * Maps finance's documented refusals (422 CREDIT_LIMIT_EXCEEDED / CUSTOMER_ACCOUNT_SUSPENDED,
     * 404 CUSTOMER_ACCOUNT_NOT_FOUND, 423 PERIOD_LOCKED) onto a single tender failure. The cashier
     * needs one clear answer — "this account cannot be charged, take another tender" — and the
     * order must stay open either way.
     */
    private void chargeToAccount(Order order, UUID customerAccountId, long amountPaisa) {
        if (customerAccountId == null) {
            throw new PosExceptions.CustomerAccountRequiredException();
        }
        LocalDate chargeDate = order.getOpenedAt() != null
                ? order.getOpenedAt().atOffset(ZoneOffset.UTC).toLocalDate()
                : LocalDate.now();
        try {
            financeArClient.charge(order.getTenantId(), new FinanceArClient.ArChargeRequest(
                    order.getBranchId(),
                    customerAccountId,
                    order.getId(),
                    chargeDate,
                    amountPaisa,
                    "POS order " + order.getOrderNo(),
                    null));
        } catch (PosExceptions.CustomerAccountRequiredException e) {
            throw e;
        } catch (Exception e) {
            throw new PosExceptions.ChargeToAccountRefusedException(e.getMessage());
        }
    }

    @Override
    @Transactional(readOnly = true)
    public List<OrderPaymentDto> listPayments(UUID orderId) {
        UUID tenantId = tenantContext.requireTenantId();

        // Tenant-scope exactly as recordPayment — 404 if the order is not the caller's tenant.
        orderRepository.findById(orderId)
                .filter(o -> tenantId.equals(o.getTenantId()))
                .orElseThrow(() -> new PosExceptions.OrderNotFoundException(orderId.toString()));

        return paymentRepository.findByOrderId(orderId).stream()
                .map(OrderPaymentDto::from)
                .collect(Collectors.toList());
    }
}
