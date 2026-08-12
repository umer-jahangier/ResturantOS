package io.restaurantos.pos.web;

import io.restaurantos.pos.service.PrintJobService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Issuing a printable document, and re-serving one that was already issued.
 *
 * <h2>Why issuing is a POST and not a GET</h2>
 *
 * <p>Issuing ALLOCATES A SEQUENCE NUMBER and writes a row. A GET that mutates would be replayed by
 * every browser prefetch, every retry and every reload — and the reprint count, which is the only
 * record of how many pieces of paper a customer was handed, would become fiction.
 *
 * <h2>Why reprinting carries the order-VIEW permission</h2>
 *
 * <p>Reprinting is reading. A cashier who may see an order may hand its bill to the customer
 * standing in front of them, and requiring a second, scarcer permission for that would mean
 * fetching a manager to re-print a torn receipt. Both endpoints therefore carry
 * {@code pos.order.view}, byte-for-byte the expression {@code OrderController.getOrder} uses —
 * which is also what {@code ControllerAuthorizationClosureTest} exists to keep honest.
 */
@RestController
@RequestMapping("/api/v1/pos")
@RequiresFeature("FEATURE_POS")
public class PrintJobController {

    private final PrintJobService printJobService;

    public PrintJobController(PrintJobService printJobService) {
        this.printJobService = printJobService;
    }

    /**
     * Issue (or re-issue) the customer receipt for an order.
     *
     * @param idempotencyKey optional; a retried request with the same key returns the same issue
     *                       rather than allocating another sequence number
     */
    @PreAuthorize("hasAuthority('pos.order.view')")
    @PostMapping("/orders/{orderId}/print-jobs")
    public ResponseEntity<ApiResponse<PrintJobService.IssuedDocument>> issue(
            @PathVariable UUID orderId,
            @RequestParam UUID branchId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(printJobService.issue(orderId, branchId, idempotencyKey)));
    }

    /**
     * Re-enqueue this order's kitchen tickets — the lost-KOT control.
     *
     * <p>Carries {@code pos.order.send_to_kds} rather than {@code pos.order.view}, and the
     * difference is deliberate. A receipt reprint hands a customer a copy of what they already
     * have; a kitchen reprint puts paper on the pass, and paper on the pass is an instruction to
     * cook. That is the same class of action as firing, so it takes the firing permission — which
     * a cashier, a waiter and a manager all hold, and a read-only viewer does not.
     *
     * <p>Returns the list of stations reprinted. An EMPTY list with a 200 means the order has no
     * kitchen ticket to reprint (nothing was ever fired, or every station was unrouted when it
     * was): a real answer the UI must be able to say out loud, not an error and not a silence.
     */
    @PreAuthorize("hasAuthority('pos.order.send_to_kds')")
    @PostMapping("/orders/{orderId}/kitchen-tickets/reprint")
    public ResponseEntity<ApiResponse<List<PrintJobService.IssuedDocument>>> reprintKitchenTickets(
            @PathVariable UUID orderId,
            @RequestParam UUID branchId) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(printJobService.reprintKitchenTickets(orderId, branchId)));
    }

    /** Re-serve a stored document verbatim. Allocates nothing. */
    @PreAuthorize("hasAuthority('pos.order.view')")
    @GetMapping("/print-jobs/{printJobId}")
    public ResponseEntity<ApiResponse<PrintJobService.IssuedDocument>> fetch(@PathVariable UUID printJobId) {
        return ResponseEntity.ok(ApiResponse.ok(printJobService.fetch(printJobId)));
    }
}
