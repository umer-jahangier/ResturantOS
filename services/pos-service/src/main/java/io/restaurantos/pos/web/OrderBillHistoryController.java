package io.restaurantos.pos.web;

import io.restaurantos.pos.domain.model.PrintJob;
import io.restaurantos.pos.repository.PrintJobRepository;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * What paper this order has produced, and when.
 *
 * <h2>Why this read exists</h2>
 *
 * <p>The register could ISSUE a bill and could re-serve one by its job id, and had no way at all to
 * answer the question a cashier actually asks: <i>has a bill been produced for this check?</i>
 * Walkthrough §3-3 turned on exactly that gap being invisible — the receipt was being created at
 * the close rather than at the tender, and nothing on any screen said so, so the defect could only
 * be found by reading {@code print_jobs} in psql. A behaviour nobody can observe is a behaviour
 * nobody can hold the product to.
 *
 * <h2>Why it is its own controller</h2>
 *
 * <p>{@code PrintJobController} owns the WRITE side — issuing, reprinting, and re-serving a single
 * job — and was mid-edit in a shared working tree when this shipped. The same reasoning
 * {@code MenuRoutingController} records applies: a separate file for a separate concern is better
 * than a merge conflict in the one place a sequence number is allocated. This class writes nothing
 * and allocates nothing.
 *
 * <h2>The gate</h2>
 *
 * <p>{@code pos.order.view}, byte-for-byte what {@code OrderController.getOrder} and
 * {@code PrintJobController.fetch} carry. Reading which documents an order produced is reading the
 * order; anyone who may see the check may see whether its bill was printed.
 */
@RestController
@RequestMapping("/api/v1/pos")
@RequiresFeature("FEATURE_POS")
public class OrderBillHistoryController {

    private final PrintJobRepository printJobRepository;
    private final TenantContext tenantContext;

    public OrderBillHistoryController(PrintJobRepository printJobRepository,
                                      TenantContext tenantContext) {
        this.printJobRepository = printJobRepository;
        this.tenantContext = tenantContext;
    }

    /**
     * Every issue of every document for one order, oldest first.
     *
     * <p>An EMPTY list is a real answer and the caller must be able to say it out loud: this order
     * has produced no paper. It is NOT the same as an error, and it is not the same as a branch
     * with no printer — that branch also produces no automatic row (D-26-01) and its bill comes out
     * of the browser instead.
     *
     * <p>The document body is deliberately NOT returned. It is large, it is already reachable
     * through {@code GET /print-jobs/{id}}, and this endpoint's job is the ledger of issues rather
     * than the paper itself.
     */
    @PreAuthorize("hasAuthority('pos.order.view')")
    @GetMapping("/orders/{orderId}/print-jobs")
    public ResponseEntity<ApiResponse<List<PrintJobIssue>>> history(@PathVariable UUID orderId) {
        UUID tenantId = tenantContext.requireTenantId();
        List<PrintJobIssue> issues = printJobRepository.findHistoryForOrder(tenantId, orderId).stream()
                .map(PrintJobIssue::of)
                .toList();
        return ResponseEntity.ok(ApiResponse.ok(issues));
    }

    /**
     * @param issueSeq         1 for the original; anything higher is a reprint of it
     * @param issuedAt         when THIS issue was stamped
     * @param originalIssuedAt null on the original; on a reprint, when the original was issued —
     *                         which is how a reader tells "the guest was handed paper at 09:12"
     *                         from "somebody looked at the bill again at 09:40"
     */
    public record PrintJobIssue(UUID printJobId,
                                String documentType,
                                String targetPrinterId,
                                int issueSeq,
                                String status,
                                Instant issuedAt,
                                Instant originalIssuedAt) {

        static PrintJobIssue of(PrintJob job) {
            return new PrintJobIssue(
                    job.getId(),
                    job.getDocumentType().name(),
                    job.getTargetPrinterId(),
                    job.getIssueSeq(),
                    job.getStatus().name(),
                    job.getIssuedAt(),
                    job.getOriginalIssuedAt());
        }
    }
}
