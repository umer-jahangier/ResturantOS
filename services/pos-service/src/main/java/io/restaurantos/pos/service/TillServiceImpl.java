package io.restaurantos.pos.service;

import io.restaurantos.pos.authz.PosAuthorizationService;
import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.domain.enums.TillStatus;
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

    /**
     * Permission that allows reading a till session belonging to SOMEONE ELSE via the
     * cashier-scoped lookup. Managers/owners reviewing tills normally go through the
     * branch-scoped {@link #listTillsForBranch} path instead; this covers the narrower
     * "look up one named cashier's till" case.
     */
    private static final String TILL_REVIEW_PERMISSION = "pos.till.review";

    /**
     * Incumbent supervisory permission that the till-review page already gates on client-side
     * ({@code PermissionGuard require="pos.order.view.all"} in app/pos/tills). Accepted alongside
     * {@link #TILL_REVIEW_PERMISSION} so that closing this hole does not lock managers out of the
     * cash-up flow before the permission catalog seeds the till-specific permission. The
     * till-specific one is the intended end state; this is the migration allowance, not the target.
     */
    private static final String ORDER_VIEW_ALL_PERMISSION = "pos.order.view.all";

    private final TillSessionRepository tillSessionRepository;
    private final OrderRepository orderRepository;
    private final OrderPaymentRepository paymentRepository;
    private final OrderRefundRepository refundRepository;
    private final EventPublisher eventPublisher;
    private final TenantContext tenantContext;
    private final PosAuthorizationService posAuthorizationService;
    private final TillCashierDirectory tillCashierDirectory;
    private final ActiveBranchGuard activeBranchGuard;
    /**
     * F21: whose drawer this was, as a name. Fail-SOFT — deliberately the soft directory and not
     * {@link TillCashierDirectory}, whose fail-CLOSED lookups decide money custody. A name is
     * decoration on a reconciliation table; an auth-service outage must cost the name and never the
     * manager's ability to read the variance.
     */
    private final StaffNameDirectory staffNameDirectory;

    public TillServiceImpl(TillSessionRepository tillSessionRepository,
                           OrderRepository orderRepository,
                           OrderPaymentRepository paymentRepository,
                           OrderRefundRepository refundRepository,
                           EventPublisher eventPublisher,
                           TenantContext tenantContext,
                           PosAuthorizationService posAuthorizationService,
                           TillCashierDirectory tillCashierDirectory,
                           ActiveBranchGuard activeBranchGuard,
                           StaffNameDirectory staffNameDirectory) {
        this.tillSessionRepository = tillSessionRepository;
        this.orderRepository = orderRepository;
        this.paymentRepository = paymentRepository;
        this.refundRepository = refundRepository;
        this.eventPublisher = eventPublisher;
        this.tenantContext = tenantContext;
        this.posAuthorizationService = posAuthorizationService;
        this.tillCashierDirectory = tillCashierDirectory;
        this.activeBranchGuard = activeBranchGuard;
        this.staffNameDirectory = staffNameDirectory;
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
        UUID tenantId = tenantContext.requireTenantId();
        UUID callerId = tenantContext.getUserId()
                .orElseThrow(() -> new PermissionDeniedException("User context required"));

        // SECURITY (till ownership): `cashierId` is client-supplied and used to be passed straight
        // to the repository, so ANY authenticated principal in the tenant could read a colleague's
        // till session — opening float, expected/declared closing and variance — just by knowing
        // their user id. RLS is tenant-only and does not scope by subject, so guard here.
        //
        // This is an identity lookup, not a filter: silently substituting the caller would answer
        // a question about Alice with Bob's row. So default a missing cashierId to the caller (the
        // POS active-till bar only ever wants its OWN till and no longer sends one) and refuse a
        // foreign id outright, mirroring listTillsForBranch's cross-branch guard below. Managers
        // reviewing tills use the branch-scoped `?branchId=` path, which is separately gated.
        UUID targetCashierId = cashierId != null ? cashierId : callerId;
        boolean readingSomeoneElse = !callerId.equals(targetCashierId);
        if (readingSomeoneElse && !canReviewTills()) {
            throw new PermissionDeniedException("Cannot read another user's till session");
        }

        TillStatus tillStatus = status != null ? TillStatus.valueOf(status) : TillStatus.OPEN;
        return tillSessionRepository.findByCashierIdAndStatus(targetCashierId, tillStatus)
                // Defense-in-depth: this query carries no tenant predicate of its own, and RLS is
                // the ONLY enforced tenant boundary here (the Hibernate tenant filter is inert), so
                // a lost/incorrect tenant context would otherwise be a cross-RESTAURANT read.
                .filter(s -> tenantId.equals(s.getTenantId()))
                // A reviewer's reach stops at their own branch, matching listTillsForBranch's
                // requireOwnBranch — otherwise pos.till.review would silently be tenant-wide.
                // Self-reads are deliberately exempt: a cashier reassigned to another branch must
                // still see their own OPEN till in the POS bar.
                .filter(s -> !readingSomeoneElse
                        || tenantContext.getBranchId().map(b -> b.equals(s.getBranchId())).orElse(false))
                .map(s -> List.of(toDto(s)))
                .orElse(List.of());
    }

    @Override
    @Transactional(readOnly = true)
    public Page<TillSessionDto> listTillsForBranch(UUID branchId, Pageable pageable) {
        // SECURITY (branch isolation): a client-supplied sibling branchId must not expose another
        // branch's till history within the same tenant — RLS is tenant-only, so guard here.
        requireOwnBranch(branchId);
        Page<TillSession> page =
                tillSessionRepository.findByBranchIdOrderByOpenedAtDesc(branchId, pageable);
        // ONE lookup per distinct cashier for the whole page, not one per row: a branch runs a
        // handful of cashiers per shift but a page of tills repeats them, and this is the screen a
        // manager refetches all evening.
        Map<UUID, String> nameById = resolveCashierNames(page.getContent());
        return page.map(s -> toDto(s, nameById));
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
     * Whether the caller may read till sessions that are not their own. Accepts the till-specific
     * permission or the incumbent supervisory one the till-review UI already requires — see
     * {@link #ORDER_VIEW_ALL_PERMISSION}. Fail-closed: {@code hasPermission} returns false when no
     * {@code JwtClaims} principal is present.
     */
    private boolean canReviewTills() {
        return posAuthorizationService.hasPermission(TILL_REVIEW_PERMISSION)
                || posAuthorizationService.hasPermission(ORDER_VIEW_ALL_PERMISSION);
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

    /**
     * One session, resolving its cashier's name on its own.
     *
     * <p>Every endpoint that returns a till funnels through here — open, close, get, the
     * single-session list shapes, the reconciliation envelope, and (via {@code getTill})
     * approve/flag/note. That is deliberate: decorating only the list would have left a row
     * snapping back to a raw UUID the instant a manager approved or flagged it, which is precisely
     * the moment they are reading the name.
     */
    private TillSessionDto toDto(TillSession s) {
        return toDto(s, null);
    }

    /**
     * The page variant: takes names already resolved in one batch.
     *
     * <p>A null {@code nameById} means "resolve this one yourself"; a non-null map means the caller
     * has already done one lookup per DISTINCT cashier for the whole page and this row should just
     * read from it. Absent from the map == unresolved == null name, which the client renders as the
     * id — never as a blank.
     */
    private TillSessionDto toDto(TillSession s, Map<UUID, String> nameById) {
        UUID cashierId = s.getCashierId();
        String cashierName = null;
        if (cashierId != null) {
            cashierName = nameById != null
                    ? nameById.get(cashierId)
                    : staffNameDirectory.resolve(tenantContext.requireTenantId(), cashierId);
        }
        return new TillSessionDto(
                s.getId(),
                s.getBranchId(),
                cashierId,
                cashierName,
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

    /**
     * Names for one page's worth of DISTINCT cashiers, in a single pass.
     *
     * <p>The de-duplication is the point, and it is what {@code StaffNameDirectory.resolveAll} is
     * for: a shift where one cashier opened and closed the drawer six times is ONE lookup, not six.
     * Ids whose name could not be resolved are simply absent from the map.
     */
    private Map<UUID, String> resolveCashierNames(List<TillSession> sessions) {
        List<UUID> cashierIds = sessions.stream()
                .map(TillSession::getCashierId)
                .filter(java.util.Objects::nonNull)
                .distinct()
                .toList();
        if (cashierIds.isEmpty()) {
            return Map.of();
        }
        return staffNameDirectory.resolveAll(tenantContext.requireTenantId(), cashierIds);
    }
}
