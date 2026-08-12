package io.restaurantos.pos.web;

import io.restaurantos.pos.dto.CloseTillRequest;
import io.restaurantos.pos.dto.EligibleCashierDto;
import io.restaurantos.pos.dto.OpenTillRequest;
import io.restaurantos.pos.dto.ReviewTillFlagRequest;
import io.restaurantos.pos.dto.ReviewTillNoteRequest;
import io.restaurantos.pos.dto.TillReconciliationDto;
import io.restaurantos.pos.dto.TillReviewActionDto;
import io.restaurantos.pos.dto.TillSessionDto;
import io.restaurantos.pos.service.TillReviewService;
import io.restaurantos.pos.service.TillService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.api.PageMeta;
import io.restaurantos.shared.feature.RequiresFeature;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/pos/tills")
@RequiresFeature("FEATURE_POS")
public class TillController {

    private final TillService tillService;
    private final TillReviewService tillReviewService;

    public TillController(TillService tillService, TillReviewService tillReviewService) {
        this.tillService = tillService;
        this.tillReviewService = tillReviewService;
    }

    @PreAuthorize("hasAuthority('pos.till.open')")
    @PostMapping
    public ResponseEntity<ApiResponse<TillSessionDto>> openTill(
            @Valid @RequestBody OpenTillRequest request) {
        TillSessionDto dto = tillService.openTill(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(dto));
    }

    @PreAuthorize("hasAuthority('pos.till.close')")
    @PostMapping("/{id}/close")
    public ResponseEntity<ApiResponse<TillSessionDto>> closeTill(
            @PathVariable UUID id,
            @Valid @RequestBody CloseTillRequest request) {
        TillSessionDto dto = tillService.closeTill(id, request);
        return ResponseEntity.ok(ApiResponse.ok(dto));
    }

    @PreAuthorize("hasAuthority('pos.till.open')")
    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<TillSessionDto>> getTill(@PathVariable UUID id) {
        TillSessionDto dto = tillService.getTill(id);
        return ResponseEntity.ok(ApiResponse.ok(dto));
    }

    @PreAuthorize("hasAuthority('pos.till.open')")
    @GetMapping
    public ResponseEntity<ApiResponse<List<TillSessionDto>>> listTills(
            @RequestParam(required = false) UUID cashierId,
            @RequestParam(required = false) UUID branchId,
            @RequestParam(required = false) String status,
            Pageable pageable) {
        // branchId → admin till-review history (newest first, paginated); otherwise the
        // legacy cashier-scoped lookup (used by the active-till bar, never paginated).
        if (branchId != null) {
            Page<TillSessionDto> page = tillService.listTillsForBranch(branchId, pageable);
            return ResponseEntity.ok(ApiResponse.paginated(page.getContent(), new PageMeta(
                    new PageMeta.Page(
                            String.valueOf(page.getNumber()),
                            page.hasNext() ? String.valueOf(page.getNumber() + 1) : null,
                            page.getSize()),
                    page.getTotalElements())));
        }
        return ResponseEntity.ok(ApiResponse.ok(tillService.listTills(cashierId, status)));
    }

    /**
     * The people a duty manager may open a drawer for at this branch (F11).
     *
     * <p>Gated on {@code pos.till.open.other} — the same permission that lets the caller act on the
     * answer, not on the weaker {@code pos.till.open} the rest of this controller uses. Who is on
     * the roster and who is already holding cash is a supervisor's view of the branch, and a
     * cashier has no use for it.
     *
     * <p>Mapped before {@code /{id}} would ever be considered, and on a literal path segment, so
     * "cashiers" is never parsed as a till id.
     */
    @PreAuthorize("hasAuthority('pos.till.open.other')")
    @GetMapping("/cashiers")
    public ResponseEntity<ApiResponse<List<EligibleCashierDto>>> listEligibleCashiers(
            @RequestParam UUID branchId) {
        return ResponseEntity.ok(ApiResponse.ok(tillService.listEligibleCashiers(branchId)));
    }

    /** Admin till-review: the session + every order within it + cash/non-cash collected. */
    @PreAuthorize("hasAuthority('pos.till.open')")
    @GetMapping("/{id}/reconciliation")
    public ResponseEntity<ApiResponse<TillReconciliationDto>> getReconciliation(@PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.ok(tillService.getReconciliation(id)));
    }

    @PostMapping("/{id}/approve")
    @PreAuthorize("hasAuthority('pos.till.review')")
    public ResponseEntity<ApiResponse<TillSessionDto>> approveTillReview(@PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.ok(tillReviewService.approve(id)));
    }

    @PostMapping("/{id}/flag")
    @PreAuthorize("hasAuthority('pos.till.review')")
    public ResponseEntity<ApiResponse<TillSessionDto>> flagTillReview(
            @PathVariable UUID id,
            @Valid @RequestBody ReviewTillFlagRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(tillReviewService.flag(id, request.reason())));
    }

    @PostMapping("/{id}/note")
    @PreAuthorize("hasAuthority('pos.till.review')")
    public ResponseEntity<ApiResponse<TillSessionDto>> addTillReviewNote(
            @PathVariable UUID id,
            @Valid @RequestBody ReviewTillNoteRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(tillReviewService.addNote(id, request.note())));
    }

    @GetMapping("/{id}/review-actions")
    @PreAuthorize("hasAuthority('pos.till.review')")
    public ResponseEntity<ApiResponse<List<TillReviewActionDto>>> tillReviewActions(@PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.ok(tillReviewService.listActions(id)));
    }
}
