package io.restaurantos.pos.config;

import io.restaurantos.pos.domain.model.PrintAgent;
import io.restaurantos.pos.service.PrintAgentEnrolmentService;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Authenticates a print agent, and authenticates nothing else.
 *
 * <h2>What this filter grants</h2>
 *
 * <p>Exactly one authority, {@link #AGENT_AUTHORITY}, which no controller in this service asks for
 * except the two agent endpoints. Every other endpoint is gated on a {@code pos.*} permission that
 * an agent does not and cannot hold, so an agent presenting its credential to an order endpoint is
 * refused by the ordinary method-security machinery rather than by a special case somebody has to
 * remember. {@code PrintJobClaimIT} asserts that.
 *
 * <h2>Why the tenant context is set from the credential before the lookup</h2>
 *
 * <p>{@code print_agents} is FORCE RLS and the agent has no tenant header — the gateway forwards
 * these two paths without resolving one, because there is no user token to resolve it from. Under
 * forced RLS a query issued with no {@code app.current_tenant_id} returns ZERO ROWS rather than
 * erroring, so the lookup has to be scoped before it runs.
 *
 * <p>The tenant is therefore taken from the credential string, set on the context, and used ONLY to
 * scope the lookup. Whether the caller is entitled to it is decided by the bcrypt comparison inside
 * {@code resolve}. Once an agent resolves, <b>the context is re-set from the ROW</b> — that is the
 * line that makes a forged tenant segment worthless.
 *
 * <h2>Header, not Authorization</h2>
 *
 * <p>A distinct {@code X-Print-Agent-Key} header rather than {@code Authorization: Bearer}, because
 * this service already has a {@code JwtAuthenticationFilter} on the Bearer scheme and feeding it a
 * non-JWT would mean a parse failure per poll and a log line that looks like an attack. Two
 * credential types, two headers, no ambiguity about which filter owns which.
 */
@Component
public class PrintAgentCredentialFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(PrintAgentCredentialFilter.class);

    public static final String HEADER = "X-Print-Agent-Key";

    /**
     * The single authority an agent holds. Deliberately not a {@code pos.*} permission: it is not
     * one, and naming it like one would eventually get it added to a role.
     */
    public static final String AGENT_AUTHORITY = "PRINT_AGENT";

    /** The two exact paths this filter serves. Same literals as the gateway's {@code AGENT_PATHS}. */
    public static final String CLAIM_PATH = "/api/v1/pos/print-agent/claim";
    public static final String ACK_PATH = "/api/v1/pos/print-agent/ack";

    /** Where the resolved agent is parked for the controller. */
    public static final String AGENT_ATTRIBUTE = "restaurantos.printAgent";

    private final PrintAgentEnrolmentService enrolmentService;
    private final TenantContext tenantContext;

    public PrintAgentCredentialFilter(PrintAgentEnrolmentService enrolmentService,
                                      TenantContext tenantContext) {
        this.enrolmentService = enrolmentService;
        this.tenantContext = tenantContext;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        return !(CLAIM_PATH.equals(path) || ACK_PATH.equals(path));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String credential = request.getHeader(HEADER);
        if (credential == null || credential.isBlank()) {
            // The source address and nothing else. Never the credential material, not even a
            // prefix of it — a prefix is still a prefix of a secret.
            log.info("print agent request from {} carried no credential", request.getRemoteAddr());
            chain.doFilter(request, response);
            return;
        }

        Optional<UUID> claimedTenant = enrolmentService.tenantOf(credential);
        if (claimedTenant.isEmpty()) {
            log.info("print agent request from {} carried a malformed credential", request.getRemoteAddr());
            chain.doFilter(request, response);
            return;
        }

        boolean hadContext = tenantContext.getTenantId().isPresent();
        try {
            // Scope the lookup. This value is attacker-controlled; it authorises nothing.
            tenantContext.set(claimedTenant.get(), null, null, null);

            Optional<PrintAgent> agent = enrolmentService.resolve(credential);
            if (agent.isEmpty()) {
                log.info("print agent request from {} was refused", request.getRemoteAddr());
                if (!hadContext) {
                    tenantContext.clear();
                }
                chain.doFilter(request, response);
                return;
            }

            PrintAgent resolved = agent.get();
            // From the ROW, not from the string. Everything downstream reads this.
            tenantContext.set(resolved.getTenantId(), resolved.getBranchId(), null, null);
            request.setAttribute(AGENT_ATTRIBUTE, resolved);

            SecurityContextHolder.getContext().setAuthentication(
                    new UsernamePasswordAuthenticationToken(
                            resolved.getId(), null,
                            List.of(new SimpleGrantedAuthority(AGENT_AUTHORITY))));

            chain.doFilter(request, response);
        } finally {
            SecurityContextHolder.clearContext();
            if (!hadContext) {
                tenantContext.clear();
            }
        }
    }
}
