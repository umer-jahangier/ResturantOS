package io.restaurantos.audit.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Guards /internal/audit/** routes by verifying the X-Internal-Service-Secret header.
 * Requests missing or presenting incorrect secrets are rejected with 403.
 */
public class InternalServiceFilter extends OncePerRequestFilter {

    private static final String HEADER = "X-Internal-Service-Secret";

    private final String expectedSecret;

    public InternalServiceFilter(String expectedSecret) {
        this.expectedSecret = expectedSecret;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain)
            throws ServletException, IOException {
        String path = request.getRequestURI();
        if (path.startsWith("/internal/")) {
            String secret = request.getHeader(HEADER);
            if (!expectedSecret.equals(secret)) {
                response.setStatus(HttpServletResponse.SC_FORBIDDEN);
                response.setContentType("application/json");
                response.getWriter().write("{\"error\":{\"code\":\"FORBIDDEN\",\"message\":\"Invalid internal secret\"}}");
                return;
            }
        }
        filterChain.doFilter(request, response);
    }
}
