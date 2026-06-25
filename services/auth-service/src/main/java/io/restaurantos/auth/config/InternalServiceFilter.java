package io.restaurantos.auth.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;

/**
 * Guards /internal/** paths with a constant-time X-Internal-Service secret check (Doc 4 §4.1).
 * Missing or incorrect secret → 403 FORBIDDEN with code INTERNAL_AUTH_REQUIRED.
 * This filter is ordered BEFORE the JWT filter so internal calls do not require a user JWT,
 * only the shared service secret. The secret is provisioned via INTERNAL_SERVICE_SECRET env var.
 */
@Component
public class InternalServiceFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Internal-Service";

    private final byte[] secretBytes;

    public InternalServiceFilter(@Value("${restaurantos.internal.secret:dev-internal-secret}") String secret) {
        this.secretBytes = secret.getBytes(StandardCharsets.UTF_8);
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/internal/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String provided = request.getHeader(HEADER);
        if (!isValid(provided)) {
            response.setStatus(HttpServletResponse.SC_FORBIDDEN);
            response.setContentType("application/json");
            response.getWriter().write(
                "{\"error\":{\"code\":\"INTERNAL_AUTH_REQUIRED\",\"message\":\"Missing or invalid X-Internal-Service secret\"}}"
            );
            return;
        }
        chain.doFilter(request, response);
    }

    private boolean isValid(String provided) {
        if (provided == null) return false;
        byte[] providedBytes = provided.getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(secretBytes, providedBytes);
    }
}
