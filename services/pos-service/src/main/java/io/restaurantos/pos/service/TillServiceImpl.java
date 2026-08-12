package io.restaurantos.pos.service;

import io.restaurantos.pos.authz.PosAuthorizationService;
import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.domain.enums.TillStatus;
import io.restaurantos.pos.domain.model.TillSession;
import io.restaurantos.pos.dto.CloseTillRequest;
import io.restaurantos.pos.dto.OpenTillRequest;
import io.restaurantos.pos.dto.TillReconciliationDto;
import io.restaurantos.pos.dto.TillSessionDto;
import io.restaurantos.pos.exception.PosExceptions;
import io.restaurantos.pos.repository.OrderPaymentRepository;
import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.pos.repository.TillSessionRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.tenant.TenantContext;
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
    private final EventPublisher eventPublisher;
    private final TenantContext tenantContext;
    private final PosAuthorizationService posAuthorizationService;

    public TillServiceImpl(TillSessionRepository tillSessionRepository,
                           OrderRepository orderRepository,
                           OrderPaymentRepository paymentRepository,
                           EventPublisher eventPublisher,
                           TenantContext tenantContext,
                           PosAuthorizationService posAuthorizationService) {
        this.tillSessionRepository = tillSessionRepository;
        this.orderRepository = orderRepository;
        this.paymentRepository = paymentRepository;
        this.eventPublisher = eventPublisher;
        this.tenantContext = tenantContext;
        this.posAuthorizationService = posAuthorizationService;
    }

    @Override
    public TillSessionDto openTill(OpenTillRequest request) {
        // SECURITY (branch isolation): reject a request-supplied branchId that differs from the
        // caller's verified JWT branch — otherwise a cashier could open a till in another branch
        // (RLS is tenant-only and would not block the cross-branch write).
        requireOwnBranch(request.branchId());

        UUID tenantId = tenantContext.requireTenantId();
        UUID cashierId = tenantContext.getUserId()
                .orElseThrow(() -> new IllegalStateException("No authenticated cashier"));

        tillSessionRepository.findByCashierIdAndStatus(cashierId, TillStatus.OPEN)
                .ifPresent(existing -> {
                    throw new PosExceptions.TillAlreadyOpenException(cashierId.toString());
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
                       "cashierId", cashierId.toString()));

        return toDto(session);
    }

    @Override
    public TillSessionDto closeTill(UUID tillId, CloseTillRequest request) {
        UUID tenantId = tenantContext.requireTenantId();

        TillSession session = tillSessionRepository.findById(tillId)
                .filter(s -> tenantId.equals(s.getTenantId()))
                .orElseThrow(() -> new PosExceptions.TillNotFoundException(tillId.toString()));

        boolean hasOpenOrders = orderRepository.findByTillSessionId(tillId).stream()
                .anyMatch(order -> !TERMINAL_STATUSES.contains(order.getStatus()));

        if (hasOpenOrders) {
            throw new PosExceptions.TillHasOpenOrdersException(tillId.toString());
        }

        long cashPaymentsTotal = orderRepository.findByTillSessionId(tillId).stream()
                .flatMap(order -> paymentRepository.findByOrderId(order.getId()).stream())
                .filter(payment -> PaymentMethod.CASH.equals(payment.getMethod()))
                .mapToLong(p -> p.getAmountPaisa())
                .sum();

        long expectedClosing = session.getOpeningFloatPaisa() + cashPaymentsTotal;

        session.setExpectedClosingPaisa(expectedClosing);
        session.setDeclaredClosingPaisa(request.declaredClosingPaisa());
        session.setStatus(TillStatus.CLOSED);
        session.setClosedAt(Instant.now());
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
    public List<TillSessionDto> listTillsForBranch(UUID branchId) {
        // SECURITY (branch isolation): a client-supplied sibling branchId must not expose another
        // branch's till history within the same tenant — RLS is tenant-only, so guard here.
        requireOwnBranch(branchId);

        // SECURITY (till review is privileged): this path returns EVERY till in the branch — each
        // one's opening float, expected/declared closing and variance. It previously enforced only
        // own-branch, so any authenticated principal in the branch (cashier, kitchen, waiter) could
        // read the whole branch's cash position. The till-review page gates on pos.order.view.all
        // CLIENT-SIDE only, which is not a boundary. Without this check the ownership guard in
        // listTills above is trivially bypassable: a cashier refused at ?cashierId=<colleague>
        // could simply ask for ?branchId=<own> and get strictly more.
        if (!canReviewTills()) {
            throw new PermissionDeniedException("Till review requires the till-review permission");
        }

        return tillSessionRepository.findByBranchIdOrderByOpenedAtDesc(branchId).stream()
                .map(this::toDto)
                .toList();
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
                paid += payment.getAmountPaisa();
                if (PaymentMethod.CASH.equals(payment.getMethod())) {
                    cash += payment.getAmountPaisa();
                } else {
                    nonCash += payment.getAmountPaisa();
                }
            }
            lines.add(new TillReconciliationDto.TillOrderLine(
                    order.getId(), order.getOrderNo(), order.getStatus(),
                    order.getTotalPaisa(), paid));
        }

        long liveExpectedCash = session.getOpeningFloatPaisa() + cash;
        return new TillReconciliationDto(
                toDto(session), orders.size(), cash, nonCash, liveExpectedCash, lines);
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
     */
    private void requireOwnBranch(UUID branchId) {
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
                s.getClosedAt()
        );
    }
}
