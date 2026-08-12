package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.domain.enums.TillStatus;
import io.restaurantos.pos.authz.PosAuthorizationService;
import io.restaurantos.pos.domain.model.TillSession;
import io.restaurantos.pos.dto.CloseTillRequest;
import io.restaurantos.pos.dto.EligibleCashierDto;
import io.restaurantos.pos.dto.OpenTillRequest;
import io.restaurantos.pos.dto.TillReconciliationDto;
import io.restaurantos.pos.dto.TillSessionDto;
import io.restaurantos.pos.exception.PosExceptions;
import io.restaurantos.pos.domain.model.OrderRefund;
import io.restaurantos.pos.repository.OrderPaymentRepository;
import io.restaurantos.pos.repository.OrderRefundRepository;
import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.pos.repository.TillSessionRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.pos.support.ActiveBranchGuard;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
@Transactional
public class TillServiceImpl implements TillService {

    private static final String POS_EXCHANGE = "pos.topic";
    private static final String TILL_OPENED_KEY = "pos.till.opened";
    private static final String TILL_OPENED_TYPE = "TILL_OPENED";
    private static final String TILL_CLOSED_KEY = "pos.till.closed";
    private static final String TILL_CLOSED_TYPE = "TILL_CLOSED";

    private static final Set<OrderStatus> TERMINAL_STATUSES = EnumSet.of(
            OrderStatus.CLOSED, OrderStatus.VOIDED, OrderStatus.REFUNDED);

    /**
     * Statuses that do NOT stop a cash-up, beyond the terminal three.
     *
     * <p>A {@code DRAFT} order is {@code createOrder} before the first {@code addItem} — the very
     * next line added flips it to OPEN ({@code OrderServiceImpl.addItem}), which is why every
     * DRAFT row in this database has no order number, no lines, no total and no payment (measured
     * 2026-08-12: 24 of 24). It is a shell, not a check.
     *
     * <p>Counting them made the close refusal say something untrue and unactionable. "This till
     * still has open orders. Settle, serve, or void them before closing" named three operations
     * that cannot be performed on a row with no lines, no money and no number — and Order
     * Management's default listing excludes DRAFT, so the cashier could not reach them to try.
     * Five such shells on the seeded drawer held it open with no remedy available to any persona,
     * manager included. That is not a guard; it is a dead end.
     *
     * <p>The guard's real question is "does this drawer still owe food or money?", and a DRAFT
     * answers no to both by construction. The other non-terminal statuses still block, unchanged.
     */
    private static final Set<OrderStatus> DOES_NOT_BLOCK_CASH_UP = EnumSet.of(OrderStatus.DRAFT);

    /**
     * The permission that lets a caller name somebody OTHER than themselves on an open.
     *
     * <p>Separate from {@code pos.till.open}, which CASHIER holds and must keep holding: opening
     * your own drawer is normal work, opening one under another person's name is a supervisory act
     * whose variance that person signs for. Seeded by auth changelog 090 to OWNER, TENANT_ADMIN
     * and MANAGER — the three roles that already review other people's tills.
     */
    private static final String OPEN_FOR_ANOTHER_CASHIER = "pos.till.open.other";

    private final TillSessionRepository tillSessionRepository;
    private final OrderRepository orderRepository;
    private final OrderPaymentRepository paymentRepository;
    private final OrderRefundRepository refundRepository;
    private final EventPublisher eventPublisher;
    private final TenantContext tenantContext;
    private final PosAuthorizationService posAuthorizationService;
    private final TillCashierDirectory tillCashierDirectory;
    private final ActiveBranchGuard activeBranchGuard;

    public TillServiceImpl(TillSessionRepository tillSessionRepository,
                           OrderRepository orderRepository,
                           OrderPaymentRepository paymentRepository,
                           OrderRefundRepository refundRepository,
                           EventPublisher eventPublisher,
                           TenantContext tenantContext,
                           PosAuthorizationService posAuthorizationService,
                           TillCashierDirectory tillCashierDirectory,
                           ActiveBranchGuard activeBranchGuard) {
        this.tillSessionRepository = tillSessionRepository;
        this.orderRepository = orderRepository;
        this.paymentRepository = paymentRepository;
        this.refundRepository = refundRepository;
        this.eventPublisher = eventPublisher;
        this.tenantContext = tenantContext;
        this.posAuthorizationService = posAuthorizationService;
        this.tillCashierDirectory = tillCashierDirectory;
        this.activeBranchGuard = activeBranchGuard;
    }

    /**
     * Cash that left the drawer as refunds against {@code orderIds} (S0-01).
     *
     * <p>Expected closing cash was {@code openingFloat + cashPayments} and stopped there. That was
     * survivable only while refunds were unreachable — they were gated on CLOSED, which a
     * paid-but-unserved check never reaches. Now that a refund is the ONLY way to undo a paid
     * order, every refund would otherwise show up as a shortage in the cashier's count: the money
     * is genuinely gone from the drawer and the expected figure still counted it.
     *
     * <p>A NULL method is a pre-V20 row of unknown tender; treated as CASH, per the migration's
     * note on which direction is safe.
     */
    private long cashRefundedFor(List<UUID> orderIds) {
        if (orderIds.isEmpty()) {
            return 0L;
        }
        return refundRepository.findByOrderIdIn(orderIds).stream()
                .filter(r -> r.getMethod() == null || PaymentMethod.CASH.equals(r.getMethod()))
                .mapToLong(OrderRefund::getRefundPaisa)
                .sum();
    }

    /**
     * Open a drawer — for the caller, or (F11) for a NAMED cashier.
     *
     * <h2>What was wrong</h2>
     *
     * <p>The cashier was derived from the caller's own subject and there was no way to say who the
     * drawer was for, so "the duty manager counts the float and hands over the drawer" — how cash
     * custody works in every restaurant — could not be expressed. Walkthrough §0: the manager
     * opened a Rs 5,000.00 float and the cashier's terminal still read {@code No active till}.
     * Measured live through the gateway on 2026-08-12, a POST carrying
     * {@code "cashierId":"<the cashier>"} had the field silently dropped and came back
     * {@code 409 TILL_ALREADY_OPEN — "Cashier already has an open till session: fefd7187-…"},
     * which is the MANAGER's own id.
     *
     * <h2>The three gates on naming somebody else</h2>
     *
     * <ol>
     *   <li><b>The caller must hold {@code pos.till.open.other}.</b> Not a widening of
     *       {@code pos.till.open} — CASHIER holds that, and must keep holding it, to open their own
     *       drawer. Refused by name, so the cashier learns whose drawer they tried to open and that
     *       it is a manager's job.</li>
     *   <li><b>The target must be rostered at THIS branch with {@code pos.till.open}.</b> A drawer
     *       opened for someone who cannot settle against it can never be cashed up. Fail-closed,
     *       including when the directory is unreachable — see {@link TillCashierDirectory}.</li>
     *   <li><b>One open till per cashier still holds, keyed on the TARGET.</b> The conflict now
     *       names the target rather than the caller, which is the fact the manager needs.</li>
     * </ol>
     *
     * <p>The branch guard runs first and is unchanged: the target is checked at the caller's own
     * JWT branch, so this cannot become a way to open a drawer in another branch.
     */
    @Override
    public TillSessionDto openTill(OpenTillRequest request) {
        // SECURITY (branch isolation): reject a request-supplied branchId that differs from the
        // caller's verified JWT branch — otherwise a cashier could open a till in another branch
        // (RLS is tenant-only and would not block the cross-branch write).
        requireOwnBranch(request.branchId());

        // ...and "is it MY branch" is not "is it OPEN". requireOwnBranch compares the request
        // against the JWT branch claim and stops. A cashier standing on a branch at the moment it
        // was deactivated still holds a token naming it, so this call was measured returning 201
        // for a retired branch — against a dialog that promises "nobody can ... start a till there".
        // See ActiveBranchGuard for why this refuses rather than degrades.
        //
        // OPEN only. closeTill is deliberately NOT guarded, and that asymmetry is the point: a
        // drawer that was already open when the branch was retired has real cash in it, and the
        // cashier must still be able to count it, declare it and have the variance recorded.
        // Guarding the close would strand money in a session nobody can finish — turning a
        // deactivation into an accounting hole, which is the opposite of what this guard is for.
        // The same reasoning covers settling checks that were already taken; this refuses NEW work.
        activeBranchGuard.requireActive(request.branchId());

        UUID tenantId = tenantContext.requireTenantId();
        UUID callerId = tenantContext.getUserId()
                .orElseThrow(() -> new IllegalStateException("No authenticated cashier"));

        // Null cashierId means "my own drawer" — every cashier's start of shift, and the only
        // shape this request had before F11. An explicit self-id is the same thing said out loud.
        UUID cashierId = request.cashierId() != null ? request.cashierId() : callerId;
        boolean forSomeoneElse = !cashierId.equals(callerId);

        if (forSomeoneElse) {
            String targetName = tillCashierDirectory.nameOf(tenantId, cashierId);
            if (!posAuthorizationService.hasPermission(OPEN_FOR_ANOTHER_CASHIER)) {
                throw new PosExceptions.TillOpenForOtherDeniedException(targetName);
            }
            tillCashierDirectory.requireCanRunADrawer(tenantId, request.branchId(), cashierId, targetName);
        }

        tillSessionRepository.findByCashierIdAndStatus(cashierId, TillStatus.OPEN)
                .ifPresent(existing -> {
                    throw forSomeoneElse
                            ? PosExceptions.TillAlreadyOpenException.forCashier(
                                    tillCashierDirectory.nameOf(tenantId, cashierId))
                            : new PosExceptions.TillAlreadyOpenException(cashierId.toString());
                });

        TillSession session = new TillSession();
        session.setTenantId(tenantId);
        session.setBranchId(request.branchId());
        session.setCashierId(cashierId);
        session.setOpeningFloatPaisa(request.openingFloatPaisa());
        session.setStatus(TillStatus.OPEN);
        session.setOpenedAt(Instant.now());
        session = tillSessionRepository.save(session);

        eventPublisher.publish(POS_EXCHANGE, TILL_OPENED_KEY, TILL_OPENED_TYPE,
                request.branchId(),
                Map.of("tillSessionId", session.getId().toString(),
                       "openingFloatPaisa", session.getOpeningFloatPaisa(),
                       // WHOSE drawer it is …
                       "cashierId", cashierId.toString(),
                       // … and WHO counted the float into it. Equal on a self-open; different when
                       // a duty manager hands the drawer over, which is exactly the pair an audit
                       // of a variance needs and which no consumer could reconstruct afterwards.
                       "openedByUserId", callerId.toString()));

        return toDto(session);
    }

    /**
     * Every cashier who may be handed a drawer at {@code branchId}, for the manager's picker.
     *
     * <p>Gated at the controller on {@code pos.till.open.other} — the same permission that lets the
     * manager act on the answer. A list of who holds the cash is not a list a cashier needs.
     */
    @Override
    @Transactional(readOnly = true)
    public List<EligibleCashierDto> listEligibleCashiers(UUID branchId) {
        requireOwnBranch(branchId);
        return tillCashierDirectory.listEligible(tenantContext.requireTenantId(), branchId);
    }

    @Override
    public TillSessionDto closeTill(UUID tillId, CloseTillRequest request) {
        UUID tenantId = tenantContext.requireTenantId();

        TillSession session = tillSessionRepository.findById(tillId)
                .filter(s -> tenantId.equals(s.getTenantId()))
                .orElseThrow(() -> new PosExceptions.TillNotFoundException(tillId.toString()));

        boolean hasOpenOrders = orderRepository.findByTillSessionId(tillId).stream()
                .anyMatch(order -> !TERMINAL_STATUSES.contains(order.getStatus())
                        && !DOES_NOT_BLOCK_CASH_UP.contains(order.getStatus()));

        if (hasOpenOrders) {
            throw new PosExceptions.TillHasOpenOrdersException(tillId.toString());
        }

        List<UUID> tillOrderIds = orderRepository.findByTillSessionId(tillId).stream()
                .map(io.restaurantos.pos.domain.model.Order::getId)
                .toList();

        // F20: `+ tipPaisa`. A cash tip is physically in the drawer — the guest put it there — so
        // an expected closing that counted only what settled the bill would report every tipped
        // check as an overage and teach the cashier to ignore the variance. The tip is still not
        // revenue; it is money the restaurant is holding, and finance books it as a liability.
        long cashPaymentsTotal = orderRepository.findByTillSessionId(tillId).stream()
                .flatMap(order -> paymentRepository.findByOrderId(order.getId()).stream())
                .filter(payment -> PaymentMethod.CASH.equals(payment.getMethod()))
                .mapToLong(p -> p.getAmountPaisa() + p.getTipPaisa())
                .sum();

        long expectedClosing =
                session.getOpeningFloatPaisa() + cashPaymentsTotal - cashRefundedFor(tillOrderIds);

        session.setExpectedClosingPaisa(expectedClosing);
        session.setDeclaredClosingPaisa(request.declaredClosingPaisa());
        session.setStatus(TillStatus.CLOSED);
        session.setClosedAt(Instant.now());
        session.setNote(request.note());
        tillSessionRepository.saveAndFlush(session);

        // Refresh to get DB-computed variance
        TillSession refreshed = tillSessionRepository.findById(tillId)
                .orElseThrow(() -> new PosExceptions.TillNotFoundException(tillId.toString()));

        long variance = request.declaredClosingPaisa() - expectedClosing;

        eventPublisher.publish(POS_EXCHANGE, TILL_CLOSED_KEY, TILL_CLOSED_TYPE,
                refreshed.getBranchId(),
                Map.of("tillSessionId", refreshed.getId().toString(),
                       "expectedCashPaisa", expectedClosing,
                       "countedCashPaisa", request.declaredClosingPaisa(),
                       "variancePaisa", variance,
                       "cashierId", refreshed.getCashierId().toString()));

        return toDto(refreshed);
    }

    @Override
    @Transactional(readOnly = true)
    public TillSessionDto getTill(UUID tillId) {
        UUID tenantId = tenantContext.requireTenantId();
        TillSession session = tillSessionRepository.findById(tillId)
                .filter(s -> tenantId.equals(s.getTenantId()))
                .orElseThrow(() -> new PosExceptions.TillNotFoundException(tillId.toString()));
        return toDto(session);
    }

    @Override
    @Transactional(readOnly = true)
    public List<TillSessionDto> listTills(UUID cashierId, String status) {
        if (status != null && cashierId != null) {
            TillStatus tillStatus = TillStatus.valueOf(status);
            return tillSessionRepository.findByCashierIdAndStatus(cashierId, tillStatus)
                    .map(s -> List.of(toDto(s)))
                    .orElse(List.of());
        }
        if (cashierId != null) {
            TillStatus open = TillStatus.OPEN;
            return tillSessionRepository.findByCashierIdAndStatus(cashierId, open)
                    .map(s -> List.of(toDto(s)))
                    .orElse(List.of());
        }
        return List.of();
    }

    @Override
    @Transactional(readOnly = true)
    public Page<TillSessionDto> listTillsForBranch(UUID branchId, Pageable pageable) {
        // SECURITY (branch isolation): a client-supplied sibling branchId must not expose another
        // branch's till history within the same tenant — RLS is tenant-only, so guard here.
        requireOwnBranch(branchId);
        return tillSessionRepository.findByBranchIdOrderByOpenedAtDesc(branchId, pageable)
                .map(this::toDto);
    }

    @Override
    @Transactional(readOnly = true)
    public TillReconciliationDto getReconciliation(UUID tillId) {
        UUID tenantId = tenantContext.requireTenantId();
        TillSession session = tillSessionRepository.findById(tillId)
                .filter(s -> tenantId.equals(s.getTenantId()))
                .orElseThrow(() -> new PosExceptions.TillNotFoundException(tillId.toString()));

        List<io.restaurantos.pos.domain.model.Order> orders = orderRepository.findByTillSessionId(tillId);
        long cash = 0L;
        long nonCash = 0L;
        List<TillReconciliationDto.TillOrderLine> lines = new java.util.ArrayList<>();

        for (io.restaurantos.pos.domain.model.Order order : orders) {
            long paid = 0L;
            for (var payment : paymentRepository.findByOrderId(order.getId())) {
                // `paid` is what settled the BILL — the figure the order line compares against
                // order.totalPaisa — so a tip must never enter it. The drawer figures below DO
                // include it, because the note is in the drawer. Same split as closeTill.
                paid += payment.getAmountPaisa();
                if (PaymentMethod.CASH.equals(payment.getMethod())) {
                    cash += payment.getAmountPaisa() + payment.getTipPaisa();
                } else {
                    nonCash += payment.getAmountPaisa() + payment.getTipPaisa();
                }
            }
            lines.add(new TillReconciliationDto.TillOrderLine(
                    order.getId(), order.getOrderNo(), order.getStatus(),
                    order.getTotalPaisa(), paid));
        }

        // Same subtraction as closeTill — the live bar and the close screen must never disagree
        // about how much cash is supposed to be in the drawer.
        long cashRefunded = cashRefundedFor(
                orders.stream().map(io.restaurantos.pos.domain.model.Order::getId).toList());
        long liveExpectedCash = session.getOpeningFloatPaisa() + cash - cashRefunded;
        return new TillReconciliationDto(
                toDto(session), orders.size(), cash - cashRefunded, nonCash, liveExpectedCash, lines);
    }

    /**
     * Defense-in-depth against a client-supplied {@code branchId} that widens scope beyond the
     * caller's JWT branch. Mirrors {@code TableServiceImpl.requireOwnBranch} — {@code branchId}
     * stays an explicit request parameter but must always equal the verified JWT branch.
     * Package-visible so {@link TillReviewService} can reuse the same check.
     */
    void requireOwnBranch(UUID branchId) {
        UUID jwtBranchId = tenantContext.getBranchId()
                .orElseThrow(() -> new PermissionDeniedException("Branch context required"));
        if (!jwtBranchId.equals(branchId)) {
            throw new PermissionDeniedException("Cannot access tills for a different branch");
        }
    }

    private TillSessionDto toDto(TillSession s) {
        return new TillSessionDto(
                s.getId(),
                s.getBranchId(),
                s.getCashierId(),
                s.getOpeningFloatPaisa(),
                s.getExpectedClosingPaisa(),
                s.getDeclaredClosingPaisa(),
                s.getVariancePaisa(),
                s.getStatus(),
                s.getOpenedAt(),
                s.getClosedAt(),
                s.getNote(),
                s.getReviewStatus()
        );
    }
}
