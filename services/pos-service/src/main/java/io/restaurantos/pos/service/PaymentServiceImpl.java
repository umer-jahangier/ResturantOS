package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.domain.enums.TillStatus;
import io.restaurantos.pos.domain.model.Order;
import io.restaurantos.pos.domain.model.OrderPayment;
import io.restaurantos.pos.domain.model.TillSession;
import io.restaurantos.pos.dto.OrderPaymentDto;
import io.restaurantos.pos.exception.PosExceptions;
import io.restaurantos.pos.feign.FinanceArClient;
import io.restaurantos.pos.repository.OrderPaymentRepository;
import io.restaurantos.pos.repository.OrderRefundRepository;
import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.pos.repository.TillSessionRepository;
import io.restaurantos.pos.support.BranchBusinessDay;
import io.restaurantos.shared.exception.FieldValidationException;
import io.restaurantos.shared.exception.StateInvalidException;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

@Service
@Transactional
public class PaymentServiceImpl implements PaymentService {

    private final OrderRepository orderRepository;
    private final OrderPaymentRepository paymentRepository;
    private final OrderRefundRepository refundRepository;
    private final TenantContext tenantContext;
    private final OrderService orderService;
    private final TillSessionRepository tillSessionRepository;
    private final FinanceArClient financeArClient;
    private final PrintDispatchService printDispatchService;
    /** The ONE answer to "which trading day is this?" — see BranchBusinessDay (S0-C). */
    private final BranchBusinessDay branchBusinessDay;

    public PaymentServiceImpl(OrderRepository orderRepository,
                              OrderPaymentRepository paymentRepository,
                              OrderRefundRepository refundRepository,
                              TenantContext tenantContext,
                              OrderService orderService,
                              TillSessionRepository tillSessionRepository,
                              FinanceArClient financeArClient,
                              // @Lazy for the same real cycle OrderServiceImpl documents:
                              //   PaymentServiceImpl -> PrintDispatchService -> PrintJobServiceImpl
                              //     -> ReceiptDocumentAssembler -> PaymentService
                              // The assembler reads this service's payment rows to print the tender
                              // lines, which is 26-03's edge and is on the receipt READ path. A
                              // proxy here encodes the right constraint — printing depends on
                              // settlement, not the other way round — and it is dereferenced only
                              // AFTER the payment transaction commits, never during startup.
                              @org.springframework.context.annotation.Lazy
                              PrintDispatchService printDispatchService,
                              BranchBusinessDay branchBusinessDay) {
        this.orderRepository = orderRepository;
        this.paymentRepository = paymentRepository;
        this.refundRepository = refundRepository;
        this.tenantContext = tenantContext;
        this.orderService = orderService;
        this.tillSessionRepository = tillSessionRepository;
        this.financeArClient = financeArClient;
        this.printDispatchService = printDispatchService;
        this.branchBusinessDay = branchBusinessDay;
    }

    @Override
    public long recordPayment(UUID orderId, PaymentMethod method, long amountPaisa, Long tenderedPaisa,
                              String referenceNo, UUID customerAccountId, long tipPaisa) {
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

        // F20. A negative tip is not a discount by another name — it would take money OFF a
        // liability owed to staff and, at till close, make the drawer short by the same figure
        // with a payment row that looks ordinary. Refused with the field named so the charge
        // screen can bind it.
        if (tipPaisa < 0) {
            throw new FieldValidationException("TIP_NEGATIVE", "tipPaisa",
                    "A tip cannot be negative. Leave it blank to take no tip.");
        }
        // A tip is only meaningful on a tender that moves money now. CHARGE_TO_ACCOUNT bills a
        // house account later and LOYALTY_POINTS spends a liability the guest already owns —
        // neither puts cash in the drawer or on the card slip, so a tip on one would be a
        // liability to staff funded by nothing.
        if (tipPaisa > 0
                && (method == PaymentMethod.CHARGE_TO_ACCOUNT || method == PaymentMethod.LOYALTY_POINTS)) {
            throw new FieldValidationException("TIP_TENDER_UNSUPPORTED", "tipPaisa",
                    "A tip cannot be taken on a " + method.name().toLowerCase().replace('_', ' ')
                            + " tender, because no money changes hands now. Take the tip on cash "
                            + "or card.");
        }

        // NO CASH WITHOUT AN OPEN DRAWER (D-30). This is the single point where the POS till
        // requirement is enforced; OrderServiceImpl.createOrder now only binds a till when the
        // creating user happens to have one, so that a waiter (no till by role design) can take
        // an order at all.
        //
        // Enforced BEFORE any amount is applied, and only for CASH. Physical cash has to end up
        // in a drawer that someone counts at close, and TillServiceImpl.closeTill computes the
        // expected closing by summing CASH payments on orders bound to that till — a cash payment
        // with no till is money the reconciliation can never see. Until now that was merely a
        // best-effort backfill (.ifPresent), so such a payment was accepted and silently left the
        // order unlinked: the "charged but the till shows 0" gap. It is now a refusal.
        //
        // Card, wallet and bank tenders are deliberately out of scope: they never pass through
        // the drawer and never reach closeTill's sum, so requiring a till for them would refuse
        // legitimate counter-less service for no reconciliation benefit.
        //
        // The status filter matters as much as the lookup. findByCashierIdAndStatus(.., OPEN) is
        // reused rather than a new query precisely so a CLOSED session — a drawer already counted
        // and signed off — can never satisfy this.
        if (method == PaymentMethod.CASH) {
            UUID payingUserId = tenantContext.getUserId()
                    .orElseThrow(() -> new PosExceptions.NoOpenTillException("<unauthenticated>"));
            TillSession openTill = tillSessionRepository
                    .findByCashierIdAndStatus(payingUserId, TillStatus.OPEN)
                    .orElseThrow(() -> new PosExceptions.NoOpenTillException(payingUserId.toString()));
            // Bind only if the order has none. An order already bound at creation stays with the
            // till that took it; re-pointing it at the settling user's drawer would move cash
            // that a second cashier never physically received.
            if (order.getTillSessionId() == null) {
                order.setTillSessionId(openTill.getId());
                orderRepository.save(order);
            }
        } else if (order.getTillSessionId() == null) {
            // Non-cash: keep the pre-existing best-effort association. It costs nothing and keeps
            // a card-settled order visible on the cashier's session, but it is never required.
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

        // Tender defaults to the requested amount PLUS the tip: a Rs 900 card tender with a Rs 50
        // tip is Rs 950 off the guest's card, and the slip has to say so. It can never be less
        // than applied + tip — ck_order_payments_tender_covers_applied refuses that row, and the
        // three numbers describe one physical handover.
        long tendered = Math.max(tenderedPaisa != null ? tenderedPaisa : amountPaisa + tipPaisa,
                applied + tipPaisa);
        long change = tendered - applied - tipPaisa;

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
        payment.setTipPaisa(tipPaisa);
        payment.setTenderedPaisa(tendered);
        payment.setChangePaisa(change);
        payment.setReferenceNo(referenceNo);
        payment.setRecordedAt(Instant.now());
        paymentRepository.save(payment);

        // ── The bill belongs to the TENDER (§3-3) ────────────────────────────────────────
        // The receipt dispatch used to hang off the close and nothing else. A check paid at
        // 02:59 and marked served at 03:15 therefore had its ORIGINAL receipt stamped 03:15:
        // the cashier counted out the change with no paper in the machine, and a guest who paid
        // and left before the kitchen bumped the last line got no bill at all — the close never
        // came while they were still in the room.
        //
        // The trigger is settlement IN FULL, not any payment. A half-paid check is not a
        // transaction the guest walks away from, and printing a bill for it would put a document
        // in someone's hand that says less than they owe.
        //
        // Registered BEFORE maybeCloseOrder so that on a check which is already served — where
        // both seams fire after this same commit — the original is attributed to the tender.
        // Both carry PrintDispatchService.automaticReceiptKey(orderId), so the second one is a
        // replay: one bill, one sheet of paper, issued when the money changed hands.
        //
        // Nothing about printing may reach the money path: dispatchReceiptAfterCommit registers
        // an after-commit callback whose body is guarded, so a broken printer cannot refuse a
        // tender the guest has already handed over.
        boolean settledInFull = applied == outstanding;
        if (settledInFull) {
            printDispatchService.dispatchReceiptAfterCommit(orderId, order.getBranchId());
        }

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
        // S0-C: the trading day this order belongs to on the BRANCH's clock, not the UTC calendar
        // date of `openedAt`. finance dates the AR charge — and therefore the customer's statement
        // and its ageing bucket — from this, so a UTC cut here put a breakfast account sale a day
        // before the revenue entry for the same order. The instant is unchanged (still `openedAt`,
        // the service the charge belongs to); only the rule that turns it into a date is.
        LocalDate chargeDate = branchBusinessDay.dateOf(
                order.getOpenedAt() != null ? order.getOpenedAt() : Instant.now(),
                order.getBranchId());
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

        // S0-01: tenders AND their reversals, oldest first. Returning payments alone meant a
        // refunded order and a voided-but-paid order looked identical here — a live tender and
        // nothing giving it back. A refund comes through as a negative row (see
        // OrderPaymentDto.reversalOf), so every existing caller's `sum(amountPaisa)` becomes the
        // NET held against the order for free.
        List<OrderPaymentDto> rows = new ArrayList<>();
        paymentRepository.findByOrderId(orderId).forEach(p -> rows.add(OrderPaymentDto.from(p)));
        refundRepository.findByOrderId(orderId).forEach(r -> rows.add(OrderPaymentDto.reversalOf(r)));
        rows.sort(Comparator.comparing(
                OrderPaymentDto::recordedAt, Comparator.nullsLast(Comparator.naturalOrder())));
        return rows;
    }
}
