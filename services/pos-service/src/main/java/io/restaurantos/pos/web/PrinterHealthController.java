package io.restaurantos.pos.web;

import io.restaurantos.pos.service.PrinterDeliveryHealthService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * What this branch's printers have actually done with the jobs they were given (S8).
 *
 * <h2>Permission</h2>
 *
 * <p>{@code pos.printers.admin}, byte-for-byte the expression on
 * {@link PrintAgentAdminController} — this is read by the same screen, for the same person, about
 * the same equipment. {@code branch.manage} is retained beside it for the same reason it is there:
 * an owner on a stack whose auth migration has not run must not be locked out of their own
 * printers.
 *
 * <p><b>No permission was widened to build this.</b> A cashier does not read this endpoint and does
 * not need to: the bill screen already learns whether its own bill printed, from the response to
 * its own issue (F8), and that path is unchanged.
 */
@RestController
@RequestMapping("/api/v1/pos/printers")
@RequiresFeature("FEATURE_POS")
public class PrinterHealthController {

    private final PrinterDeliveryHealthService healthService;

    public PrinterHealthController(PrinterDeliveryHealthService healthService) {
        this.healthService = healthService;
    }

    /**
     * An EMPTY printer list with a 200 is a real answer — "nothing has been sent to any printer on
     * this branch today" — and the screen says exactly that. It is not an error and it is not the
     * same as a printer that has failed, which is why the two are different shapes here.
     */
    @GetMapping("/health")
    @PreAuthorize("hasAnyAuthority('pos.printers.admin', 'branch.manage')")
    public ResponseEntity<ApiResponse<PrinterDeliveryHealthService.BranchPrintHealth>> health(
            @RequestParam UUID branchId) {
        return ResponseEntity.ok(ApiResponse.ok(healthService.forBranch(branchId)));
    }
}
