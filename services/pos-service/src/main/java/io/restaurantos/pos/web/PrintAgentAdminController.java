package io.restaurantos.pos.web;

import io.restaurantos.pos.service.PrintAgentEnrolmentService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Enrolling, listing and revoking print agents — the administrator's half of 26-11.
 *
 * <h2>Gated on branch management, deliberately</h2>
 *
 * <p>{@code pos.printers.admin} is the same permission 26-02's printer registry now carries, and
 * for the same reason: enrolling an agent decides what may print on a branch's printers, which is
 * branch equipment catalogue and not a cashier's business. This is NOT the D-2 problem — D-2 was
 * about a CASHIER needing to read the agent's base URL during a settlement, and its resolution is
 * that the agent authenticates as a DEVICE. Nothing on this controller is on a settlement path.
 *
 * <p>It shipped gated on {@code branch.manage} alone, whose catalogue description is "Create,
 * update and deactivate branches" and which OWNER and TENANT_ADMIN hold exclusively. Measured live:
 * a branch MANAGER — the person who installs the agent on the till — got a 403 listing their own
 * branch's agents. {@code branch.manage} is retained in the expression so an owner is not locked
 * out on a stack whose auth migration has not run; the correct code is the specific one.
 *
 * <p>Separate from {@link PrintAgentController} on purpose. That one is reached by a device
 * credential and by no user; this one is reached by a user and by no device. Two audiences, two
 * classes, no endpoint that has to work out which it is talking to.
 */
@RestController
@RequestMapping("/api/v1/pos/print-agents")
@RequiresFeature("FEATURE_POS")
public class PrintAgentAdminController {

    private final PrintAgentEnrolmentService enrolmentService;

    public PrintAgentAdminController(PrintAgentEnrolmentService enrolmentService) {
        this.enrolmentService = enrolmentService;
    }

    public record EnrolRequest(@NotNull UUID branchId, @Size(max = 120) String label) {}

    /**
     * The ONLY response in this product that contains an agent secret. It is not stored in clear,
     * not returned by any read, not logged and not put in an event — so a manager who loses it
     * re-enrols rather than recovering it, and the UI says so before they close the dialog.
     */
    @PostMapping
    @PreAuthorize("hasAnyAuthority('branch.manage', 'pos.printers.admin')")
    public ResponseEntity<ApiResponse<PrintAgentEnrolmentService.Enrolled>> enrol(
            @Valid @RequestBody EnrolRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(
                enrolmentService.enrol(request.branchId(), request.label())));
    }

    @GetMapping
    @PreAuthorize("hasAnyAuthority('branch.manage', 'pos.printers.admin')")
    public ResponseEntity<ApiResponse<List<PrintAgentEnrolmentService.AgentView>>> list(
            @RequestParam UUID branchId) {
        return ResponseEntity.ok(ApiResponse.ok(enrolmentService.list(branchId)));
    }

    @DeleteMapping("/{agentId}")
    @PreAuthorize("hasAnyAuthority('branch.manage', 'pos.printers.admin')")
    public ResponseEntity<ApiResponse<PrintAgentEnrolmentService.AgentView>> revoke(
            @PathVariable UUID agentId) {
        return ResponseEntity.ok(ApiResponse.ok(enrolmentService.revoke(agentId)));
    }
}
