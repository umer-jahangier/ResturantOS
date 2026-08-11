package io.restaurantos.shared.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jws;
import io.jsonwebtoken.Jwts;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.security.PublicKey;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * RS256 JWT validation filter (XCUT-02). Verifies signature against JWKS (cached, 1h TTL),
 * checks expiry, builds Authentication, and populates TenantContext + MDC.
 * MUST be cleared in finally.
 *
 * NOT auto-wired into any SecurityFilterChain in shared-lib (shipped, not assembled).
 * Phase 2 (auth-service) assembles the chain and registers this filter.
 */
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwksKeyProvider keyProvider;
    private final TenantContext tenantContext;

    public JwtAuthenticationFilter(JwksKeyProvider keyProvider, TenantContext tenantContext) {
        this.keyProvider = keyProvider;
        this.tenantContext = tenantContext;
    }

    @Override
    @SuppressWarnings("unchecked")
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header == null || !header.startsWith("Bearer ")) {
            // No token — but this request STILL has to clear tenant context on the way out.
            //
            // This early return used to skip the finally block below, and that leaked one tenant's
            // data to the next request on the same Tomcat worker thread. The path that does it:
            // `/internal/**` endpoints authenticate with a shared secret, not a Bearer token, so
            // they land here; and BranchInternalController.setTenantGuc calls tenantContext.set(..)
            // itself from the X-Tenant-Id header. Nothing then cleared it. The thread went back to
            // the pool still bound to that tenant.
            //
            // Observed (2026-08-11), the request that proves it: GET /internal/users/branches/{id}
            // with the internal secret and NO X-Tenant-Id header returned 200 carrying tenant A's
            // branch, immediately after an A-scoped call on the same worker — and 409 when the
            // preceding call differed. The same request answering differently depending on what
            // the thread did before it is the signature of leaked thread-local state.
            //
            // Clearing here is safe for the authenticated case too: `finally` runs after the entire
            // downstream chain, so every controller has already read whatever it set.
            try {
                chain.doFilter(request, response);
            } finally {
                tenantContext.clear();
                MDC.clear();
            }
            return;
        }
        String token = header.substring(7);
        try {
            String kid = JwtClaims.peekKid(token);
            PublicKey publicKey = keyProvider.getKey(kid);

            Jws<Claims> jws = Jwts.parser().verifyWith(publicKey).build().parseSignedClaims(token);
            Claims c = jws.getPayload();

            UUID userId = UUID.fromString(c.getSubject());
            UUID tenantId = c.get("tenant_id") != null ? UUID.fromString(c.get("tenant_id", String.class)) : null;
            UUID branchId = c.get("branch_id") != null ? UUID.fromString(c.get("branch_id", String.class)) : null;
            UUID impersonatedBy = c.get("impersonated_by") != null ? UUID.fromString(c.get("impersonated_by", String.class)) : null;
            List<String> roles = c.get("roles", List.class);
            List<String> permissions = c.get("permissions", List.class);
            Map<String, Object> attributes = c.get("attributes", Map.class);
            // Step-up signal, minted by auth-service only when a TOTP code was actually verified
            // during login. Absent/non-boolean reads as false — a token that predates the claim
            // has not stepped up.
            boolean totpVerified = Boolean.TRUE.equals(c.get("totp_verified", Boolean.class));

            var authorities = toAuthorities(permissions, roles);
            var authentication = new UsernamePasswordAuthenticationToken(
                new JwtClaims(userId, tenantId, branchId, roles, permissions, attributes,
                    impersonatedBy, totpVerified),
                null, authorities);
            SecurityContextHolder.getContext().setAuthentication(authentication);

            tenantContext.set(tenantId, branchId, userId, impersonatedBy);
            if (tenantId != null) MDC.put("tenantId", tenantId.toString());
            String traceId = request.getHeader("X-Request-Id");
            MDC.put("traceId", traceId != null ? traceId : UUID.randomUUID().toString());

            chain.doFilter(request, response);
        } catch (Exception e) {
            SecurityContextHolder.clearContext();
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json");
            response.getWriter().write("{\"error\":{\"code\":\"UNAUTHENTICATED\",\"message\":\"Invalid token\"}}");
        } finally {
            tenantContext.clear();
            MDC.clear();
        }
    }

    /**
     * Builds the Spring authority set as the union of the {@code permissions} and {@code roles}
     * claims.
     *
     * <p><b>Why the union exists.</b> This used to read {@code permissions} alone. That silently
     * made every role-shaped gate inert: {@code @PreAuthorize("hasAuthority('SUPER_ADMIN')")} —
     * the class-level gate on {@code PlatformAdminController} — could not be satisfied by any
     * token this platform mints, because SUPER_ADMIN is a role and appears in no permission
     * catalog. The whole {@code /api/v1/platform/**} API was unreachable for that one reason
     * (audit 2026-08-06, blocker B1, cause 2). Nothing failed; the gate just never opened.
     *
     * <p><b>Why it is safe.</b> Strictly additive. It grants authorities that were previously
     * unreachable and revokes none, so no existing permission-based gate changes behaviour. Both
     * claims are attacker-irrelevant: they are read only after the RS256 signature has been
     * verified against JWKS, and only auth-service's signers ever populate them.
     *
     * <p><b>Invariant.</b> This method is the ONE place authorities are derived. Any future
     * authority source is added here, never per-service — a service-local variant is how a gate
     * comes to be enforced in one process and inert in another, which is the defect class above.
     */
    private static List<SimpleGrantedAuthority> toAuthorities(List<String> permissions, List<String> roles) {
        // LinkedHashSet: deduplicates (the platform token carries its role in BOTH claims) while
        // keeping permissions-then-roles order stable, so assertions stay deterministic.
        var names = new LinkedHashSet<String>();
        if (permissions != null) names.addAll(permissions);
        if (roles != null) names.addAll(roles);
        return names.stream().map(SimpleGrantedAuthority::new).toList();
    }
}
