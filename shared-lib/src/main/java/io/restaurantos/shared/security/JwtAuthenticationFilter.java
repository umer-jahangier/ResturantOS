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
            chain.doFilter(request, response);
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

            var authorities = permissions == null ? List.<SimpleGrantedAuthority>of()
                : permissions.stream().map(SimpleGrantedAuthority::new).toList();
            var authentication = new UsernamePasswordAuthenticationToken(
                new JwtClaims(userId, tenantId, branchId, roles, permissions, attributes, impersonatedBy),
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
}
