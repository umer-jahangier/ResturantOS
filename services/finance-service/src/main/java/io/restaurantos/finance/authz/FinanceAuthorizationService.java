package io.restaurantos.finance.authz;

import io.restaurantos.finance.feign.AuthorizationClient;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.exception.PermissionDeniedException;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * Finance's OPA enforcement point — one method per {@code finance.rego} action.
 *
 * <p>{@code finance.rego} ships seven rules. Before phase 18b, <b>one</b> of them was reachable:
 * {@code approve}, called from {@code ExpenseService}. The other six — {@code close_period},
 * {@code view_coa}, {@code manage_coa}, {@code view_journal}, {@code post_journal} and
 * {@code reverse_journal} — were dead letters. Accounting-period close, the money-moving control at
 * the centre of this service, was bounded by nothing but a permission code and the TOTP claim.
 *
 * <p>The {@code attributes} claim (notably {@code approval_limit_paisa}) is readable only by OPA;
 * {@code @PreAuthorize} never inspects it. So for anything amount-bounded there is no RBAC fallback
 * — an unreachable rule means the bound is not applied at all, rather than applied more loosely.
 *
 * <h2>Routing, and why it is Feign rather than a direct client</h2>
 *
 * <p>finance-service reaches OPA through authorization-service, reusing the existing
 * {@link AuthorizationClient} and its {@code FeignClientConfig} — which forwards the end user's
 * bearer token, so the decision is made about the caller and not about the service. That is
 * deliberately the same route {@code ExpenseService} already used. Adding a second, direct-OPA
 * client here would give finance-service two independent policy paths with two timeout
 * configurations and two failure modes, which is precisely the fragmentation this phase set out to
 * remove.
 *
 * <h2>Fail-closed</h2>
 *
 * <p>A missing body, a {@code false} decision, or any transport failure all deny. Feign throws on a
 * transport error, and that exception is translated here rather than left to surface as a 500, so
 * an unreachable policy engine produces an honest 403 — the same answer OPA would have given if it
 * had been asked and said no.
 */
@Service
public class FinanceAuthorizationService {

    private static final String MODULE = "finance";

    private final AuthorizationClient authorizationClient;

    public FinanceAuthorizationService(AuthorizationClient authorizationClient) {
        this.authorizationClient = authorizationClient;
    }

    /** {@code close_period} — tenant-scoped in the policy; branch is carried for the audit trail. */
    public void authorizeClosePeriod(UUID periodId, UUID tenantId, UUID branchId) {
        evaluate(new AuthorizationClient.AuthorizePayload(MODULE, "close_period",
                resource("accounting_period", periodId, tenantId, branchId)));
    }

    public void authorizeViewCoa(UUID tenantId, UUID branchId) {
        evaluate(new AuthorizationClient.AuthorizePayload(MODULE, "view_coa",
                resource("chart_of_account", null, tenantId, branchId)));
    }

    public void authorizeManageCoa(UUID tenantId, UUID branchId) {
        evaluate(new AuthorizationClient.AuthorizePayload(MODULE, "manage_coa",
                resource("chart_of_account", null, tenantId, branchId)));
    }

    public void authorizeViewJournal(UUID journalEntryId, UUID tenantId, UUID branchId) {
        evaluate(new AuthorizationClient.AuthorizePayload(MODULE, "view_journal",
                resource("journal_entry", journalEntryId, tenantId, branchId)));
    }

    public void authorizePostJournal(UUID journalEntryId, UUID tenantId, UUID branchId) {
        evaluate(new AuthorizationClient.AuthorizePayload(MODULE, "post_journal",
                resource("journal_entry", journalEntryId, tenantId, branchId)));
    }

    public void authorizeReverseJournal(UUID journalEntryId, UUID tenantId, UUID branchId) {
        evaluate(new AuthorizationClient.AuthorizePayload(MODULE, "reverse_journal",
                resource("journal_entry", journalEntryId, tenantId, branchId)));
    }

    private static AuthorizationClient.Resource resource(String type, UUID id,
                                                         UUID tenantId, UUID branchId) {
        return new AuthorizationClient.Resource(type, id, tenantId, branchId, null, null, null);
    }

    /**
     * Each method above names its action as a LITERAL in the payload rather than routing it through
     * a shared dispatcher that takes {@code String action}. {@code PolicyReachabilityTest} proves
     * every rego rule has a caller by reading the (module, action) pairs out of the source, and a
     * dispatcher hides the pair from it — the test reports such a call site as unresolvable and
     * fails rather than assuming it is fine. Only the transport and the deny decision, which the
     * test does not read, are shared here.
     */
    private void evaluate(AuthorizationClient.AuthorizePayload payload) {
        ApiResponse<AuthorizationClient.AuthorizeResult> response;
        try {
            response = authorizationClient.authorize(payload);
        } catch (RuntimeException e) {
            // BLR-5: an unreachable or slow policy engine denies. Letting the Feign exception
            // propagate would surface as a 5xx, which is closed in effect but reports a server
            // fault for what is an authorization outcome.
            throw new PermissionDeniedException("Authorization service unavailable");
        }
        if (response == null || response.data() == null || !response.data().allow()) {
            throw new PermissionDeniedException("Not permitted: " + MODULE + "." + payload.action());
        }
    }
}
