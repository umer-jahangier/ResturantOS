package io.restaurantos.pos.web;

import io.restaurantos.pos.config.PrintAgentCredentialFilter;
import io.restaurantos.pos.domain.model.PrintAgent;
import io.restaurantos.pos.service.BranchPrinterRegistryService;
import io.restaurantos.pos.service.PrintAgentEnrolmentService;
import io.restaurantos.pos.service.PrintJobClaimService;
import io.restaurantos.shared.api.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * The two endpoints a print agent may reach, and the only two.
 *
 * <h2>Why both paths are static literals</h2>
 *
 * <p>The acknowledge endpoint takes its job identifier in the <b>body</b>, not as a path variable,
 * and that is a security decision rather than a REST style preference. The gateway exempts these
 * two paths from the user-JWT check by <b>exact equality</b>. A {@code /{jobId}} in the path would
 * force the gateway to match by prefix instead, and a prefix exemption widens to every future route
 * sharing those characters — which is precisely the widening the exact-equality design exists to
 * prevent.
 *
 * <p>If you are here to make this "properly RESTful": don't. The near-miss classification tests in
 * {@code JwtGlobalFilterAgentPathTest} will fail, and they are failing on purpose.
 *
 * <h2>Authority</h2>
 *
 * <p>{@code PRINT_AGENT} is not a {@code pos.*} permission and is held by no user. Every other
 * endpoint in this service requires one of those, so an agent credential presented to an order
 * endpoint is refused by ordinary method security — no special case, nothing to remember.
 */
@RestController
public class PrintAgentController {

    private final PrintJobClaimService claimService;
    private final PrintAgentEnrolmentService enrolmentService;
    private final BranchPrinterRegistryService registryService;

    public PrintAgentController(PrintJobClaimService claimService,
                                PrintAgentEnrolmentService enrolmentService,
                                BranchPrinterRegistryService registryService) {
        this.claimService = claimService;
        this.enrolmentService = enrolmentService;
        this.registryService = registryService;
    }

    public record ClaimRequest(Integer max) {}

    /**
     * The claim response: this agent's work, and the printers it is allowed to drive.
     *
     * <p>The registry rides on the claim rather than on an endpoint of its own because adding a
     * third agent path would mean widening {@code JwtGlobalFilter.AGENT_PATHS} — a security
     * boundary with a test pinning its exact contents, and one this repair has no reason to touch.
     * The poll already runs every few seconds and is already scoped to the branch on the agent's
     * ROW, so the registry it carries is fresh within one poll interval and cannot address another
     * branch's hardware.
     *
     * <p><b>Sent on every poll, including an empty one.</b> A registry that arrived only alongside
     * work would leave an agent that has printed nothing yet unable to answer "which printers do
     * you have" — and would make a manager's first Test Print depend on a job having been queued
     * first, which is backwards.
     *
     * @param printers may be empty. Empty means "this branch has configured no printers", which the
     *                 agent must be able to tell from "the registry did not arrive" — so the field
     *                 is always present and is never null.
     */
    public record AgentWork(java.util.List<PrintJobClaimService.ClaimedJob> jobs,
                            java.time.Instant leaseExpiresAt,
                            java.util.List<BranchPrinterRegistryService.AgentPrinter> printers) {}

    public record AckRequest(@NotNull UUID printJobId,
                             @NotNull PrintJobClaimService.AckResult result,
                             String error) {}

    @PostMapping(PrintAgentCredentialFilter.CLAIM_PATH)
    @PreAuthorize("hasAuthority('" + PrintAgentCredentialFilter.AGENT_AUTHORITY + "')")
    public ResponseEntity<ApiResponse<AgentWork>> claim(
            HttpServletRequest request,
            @RequestBody(required = false) ClaimRequest body) {
        PrintAgent agent = agentOf(request);
        enrolmentService.recordSeen(agent.getId());
        int max = body == null || body.max() == null ? 5 : body.max();
        // An empty list, with a 200. NOT a 204 and NOT an error: the agent has to be able to tell
        // "nothing queued" from "wired wrong", and under forced RLS those two look identical unless
        // the shape of the answer distinguishes them.
        PrintJobClaimService.ClaimResult claimed = claimService.claim(agent, max);
        // The branch comes from the agent ROW, never from anything the client sent — the same rule
        // the claim itself obeys.
        return ResponseEntity.ok(ApiResponse.ok(new AgentWork(
                claimed.jobs(),
                claimed.leaseExpiresAt(),
                registryService.forBranch(agent.getBranchId()))));
    }

    @PostMapping(PrintAgentCredentialFilter.ACK_PATH)
    @PreAuthorize("hasAuthority('" + PrintAgentCredentialFilter.AGENT_AUTHORITY + "')")
    public ResponseEntity<ApiResponse<PrintJobClaimService.AckOutcome>> acknowledge(
            HttpServletRequest request,
            @Valid @RequestBody AckRequest body) {
        PrintAgent agent = agentOf(request);
        return ResponseEntity.ok(ApiResponse.ok(
                claimService.acknowledge(agent, body.printJobId(), body.result(), body.error())));
    }

    private static PrintAgent agentOf(HttpServletRequest request) {
        Object agent = request.getAttribute(PrintAgentCredentialFilter.AGENT_ATTRIBUTE);
        if (agent instanceof PrintAgent printAgent) {
            return printAgent;
        }
        // Unreachable while @PreAuthorize holds — the authority is only ever granted alongside the
        // attribute. Loud rather than a null pointer, because "unreachable" is a claim about today.
        throw new IllegalStateException("print agent authority without a resolved agent");
    }
}
