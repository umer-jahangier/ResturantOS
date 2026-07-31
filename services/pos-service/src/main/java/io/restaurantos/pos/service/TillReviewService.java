package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.enums.TillReviewStatus;
import io.restaurantos.pos.domain.enums.TillStatus;
import io.restaurantos.pos.domain.model.TillReviewAction;
import io.restaurantos.pos.domain.model.TillSession;
import io.restaurantos.pos.dto.TillReviewActionDto;
import io.restaurantos.pos.dto.TillSessionDto;
import io.restaurantos.pos.exception.PosExceptions;
import io.restaurantos.pos.repository.TillReviewActionRepository;
import io.restaurantos.pos.repository.TillSessionRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.exception.StateInvalidException;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Manager/owner review of a CLOSED till session: approve, flag, or add a note. Orthogonal to
 * {@link TillStatus} (operational OPEN/CLOSED lifecycle) — {@code reviewStatus} is a separate
 * audit/review overlay, and every action is additionally recorded as an append-only
 * {@link TillReviewAction} row so the full review history survives regardless of the session's
 * current reviewStatus. Mirrors purchasing-service's PoApprovalService/PoApprovalRecord pattern.
 */
@Service
@Transactional
public class TillReviewService {

    private static final String POS_EXCHANGE = "pos.topic";
    private static final String TILL_REVIEWED_KEY = "pos.till.reviewed";
    private static final String TILL_REVIEWED_TYPE = "TILL_REVIEWED";

    private final TillSessionRepository tillSessionRepository;
    private final TillReviewActionRepository tillReviewActionRepository;
    private final TillServiceImpl tillService;
    private final EventPublisher eventPublisher;
    private final TenantContext tenantContext;

    public TillReviewService(TillSessionRepository tillSessionRepository,
                              TillReviewActionRepository tillReviewActionRepository,
                              TillServiceImpl tillService,
                              EventPublisher eventPublisher,
                              TenantContext tenantContext) {
        this.tillSessionRepository = tillSessionRepository;
        this.tillReviewActionRepository = tillReviewActionRepository;
        this.tillService = tillService;
        this.eventPublisher = eventPublisher;
        this.tenantContext = tenantContext;
    }

    public TillSessionDto approve(UUID tillId) {
        return act(tillId, "APPROVED", null, TillReviewStatus.APPROVED);
    }

    public TillSessionDto flag(UUID tillId, String reason) {
        return act(tillId, "FLAGGED", reason, TillReviewStatus.FLAGGED);
    }

    public TillSessionDto addNote(UUID tillId, String note) {
        return act(tillId, "NOTED", note, null);
    }

    @Transactional(readOnly = true)
    public List<TillReviewActionDto> listActions(UUID tillId) {
        UUID tenantId = tenantContext.requireTenantId();
        TillSession session = loadOwnTenantSession(tillId, tenantId);
        tillService.requireOwnBranch(session.getBranchId());
        return tillReviewActionRepository.findByTillSessionIdOrderByActedAtDesc(tillId).stream()
                .map(this::toDto)
                .toList();
    }

    private TillSessionDto act(UUID tillId, String action, String note, TillReviewStatus newReviewStatus) {
        UUID tenantId = tenantContext.requireTenantId();
        TillSession session = loadOwnTenantSession(tillId, tenantId);
        tillService.requireOwnBranch(session.getBranchId());

        if (session.getStatus() != TillStatus.CLOSED) {
            throw new StateInvalidException("Till must be closed before it can be reviewed: " + tillId);
        }

        UUID reviewerId = tenantContext.getUserId()
                .orElseThrow(() -> new IllegalStateException("No authenticated reviewer"));

        TillReviewAction record = new TillReviewAction();
        record.setTenantId(tenantId);
        record.setTillSessionId(tillId);
        record.setReviewerId(reviewerId);
        record.setAction(action);
        record.setNote(note);
        record.setActedAt(Instant.now());
        tillReviewActionRepository.save(record);

        if (newReviewStatus != null) {
            session.setReviewStatus(newReviewStatus);
            tillSessionRepository.saveAndFlush(session);
        }

        eventPublisher.publish(POS_EXCHANGE, TILL_REVIEWED_KEY, TILL_REVIEWED_TYPE,
                session.getBranchId(),
                Map.of("tillSessionId", tillId.toString(),
                       "userId", reviewerId.toString(),
                       "action", action,
                       "cashierId", session.getCashierId().toString(),
                       "reviewStatus", session.getReviewStatus().name(),
                       "note", note == null ? "" : note));

        return tillService.getTill(tillId);
    }

    private TillSession loadOwnTenantSession(UUID tillId, UUID tenantId) {
        return tillSessionRepository.findById(tillId)
                .filter(s -> tenantId.equals(s.getTenantId()))
                .orElseThrow(() -> new PosExceptions.TillNotFoundException(tillId.toString()));
    }

    private TillReviewActionDto toDto(TillReviewAction a) {
        return new TillReviewActionDto(
                a.getId(), a.getTillSessionId(), a.getReviewerId(), a.getAction(), a.getNote(), a.getActedAt());
    }
}
