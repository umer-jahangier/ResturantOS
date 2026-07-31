package io.restaurantos.pos;

import io.restaurantos.pos.dto.CloseTillRequest;
import io.restaurantos.pos.dto.OpenTillRequest;
import io.restaurantos.pos.dto.TillReviewActionDto;
import io.restaurantos.pos.dto.TillSessionDto;
import io.restaurantos.pos.service.TillReviewService;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.exception.StateInvalidException;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Manager/owner till review (approve / flag / note). Review state is orthogonal to the
 * OPEN/CLOSED lifecycle, so these assert both the reviewStatus projection on the session and
 * the append-only action history that survives independently of it.
 */
class TillReviewServiceIT extends PosTestBase {

    @Autowired TillReviewService tillReviewService;
    @Autowired TenantContext tenantContext;
    @Autowired OutboxRepository outboxRepository;

    UUID tenantId;
    UUID branchId;
    UUID cashierId;

    @BeforeEach
    void setUp() {
        outboxRepository.deleteAll();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        cashierId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, cashierId, null);
    }

    private TillSessionDto openAndCloseTill() {
        TillSessionDto open = tillService.openTill(new OpenTillRequest(branchId, 50000L));
        return tillService.closeTill(open.id(), new CloseTillRequest(50000L, "counted twice"));
    }

    @Test
    void closedTill_startsPendingReview_andCarriesTheCashierNote() {
        TillSessionDto closed = openAndCloseTill();

        assertThat(closed.reviewStatus().name()).isEqualTo("PENDING_REVIEW");
        assertThat(closed.note()).isEqualTo("counted twice");
    }

    @Test
    void approve_setsApproved_recordsAction_and_publishesTILL_REVIEWED() {
        TillSessionDto closed = openAndCloseTill();

        TillSessionDto approved = tillReviewService.approve(closed.id());

        assertThat(approved.reviewStatus().name()).isEqualTo("APPROVED");

        List<TillReviewActionDto> actions = tillReviewService.listActions(closed.id());
        assertThat(actions).hasSize(1);
        assertThat(actions.get(0).action()).isEqualTo("APPROVED");
        assertThat(actions.get(0).reviewerId()).isEqualTo(cashierId);

        long reviewed = outboxRepository.findAll().stream()
                .filter(e -> "TILL_REVIEWED".equals(e.getEventType()))
                .count();
        assertThat(reviewed).isEqualTo(1);
    }

    @Test
    void flag_setsFlagged_andStoresTheReason() {
        TillSessionDto closed = openAndCloseTill();

        TillSessionDto flagged = tillReviewService.flag(closed.id(), "cash short, no explanation");

        assertThat(flagged.reviewStatus().name()).isEqualTo("FLAGGED");
        assertThat(tillReviewService.listActions(closed.id()).get(0).note())
                .isEqualTo("cash short, no explanation");
    }

    @Test
    void addNote_recordsTheActionButLeavesReviewStatusUnchanged() {
        TillSessionDto closed = openAndCloseTill();

        TillSessionDto noted = tillReviewService.addNote(closed.id(), "asked cashier to recount");

        assertThat(noted.reviewStatus().name()).isEqualTo("PENDING_REVIEW");
        List<TillReviewActionDto> actions = tillReviewService.listActions(closed.id());
        assertThat(actions).hasSize(1);
        assertThat(actions.get(0).action()).isEqualTo("NOTED");
    }

    @Test
    void reviewActionsAccumulate_newestFirst_andLaterActionsOverrideTheStatus() {
        TillSessionDto closed = openAndCloseTill();

        tillReviewService.approve(closed.id());
        TillSessionDto reflagged = tillReviewService.flag(closed.id(), "reopened after audit");

        // An approved till can be flagged again later — the projection follows the latest action,
        // and the full history is still recoverable.
        assertThat(reflagged.reviewStatus().name()).isEqualTo("FLAGGED");
        List<TillReviewActionDto> actions = tillReviewService.listActions(closed.id());
        assertThat(actions).hasSize(2);
        assertThat(actions.get(0).action()).isEqualTo("FLAGGED");
    }

    @Test
    void reviewingAnOpenTill_isRejected() {
        TillSessionDto open = tillService.openTill(new OpenTillRequest(branchId, 50000L));

        assertThatThrownBy(() -> tillReviewService.approve(open.id()))
                .isInstanceOf(StateInvalidException.class);
    }

    @Test
    void reviewingATillFromAnotherBranch_isDenied() {
        TillSessionDto closed = openAndCloseTill();

        // Same tenant, different verified JWT branch — RLS is tenant-only, so the service-layer
        // branch guard is the thing standing between branches here.
        tenantContext.set(tenantId, UUID.randomUUID(), UUID.randomUUID(), null);

        assertThatThrownBy(() -> tillReviewService.approve(closed.id()))
                .isInstanceOf(PermissionDeniedException.class);
    }
}
