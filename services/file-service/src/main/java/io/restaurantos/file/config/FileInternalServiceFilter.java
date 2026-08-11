package io.restaurantos.file.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * Guards {@code /internal/**} with a constant-time {@code X-Internal-Service} secret check
 * (Doc 4 §4.1) — same shape as {@code FinanceInternalServiceFilter} and
 * {@code CrmInternalServiceFilter}, which is deliberate: an internal seam that authenticates
 * differently from every other internal seam is one nobody audits correctly.
 *
 * <p>{@link MessageDigest#isEqual} rather than {@code String.equals} so a wrong secret takes the
 * same time to reject regardless of how many leading characters were right.
 */
@Component
public class FileInternalServiceFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Internal-Service";

    private final byte[] secretBytes;

    public FileInternalServiceFilter(
            @Value("${restaurantos.internal.secret:dev-internal-secret}") String secret) {
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
        if (!isValid(request.getHeader(HEADER))) {
            response.setStatus(HttpServletResponse.SC_FORBIDDEN);
            response.setContentType("application/json");
            response.getWriter().write(
                "{\"error\":{\"code\":\"INTERNAL_AUTH_REQUIRED\","
                    + "\"message\":\"Missing or invalid X-Internal-Service secret\"}}"
            );
            return;
        }
        chain.doFilter(request, response);
    }

    private boolean isValid(String provided) {
        if (provided == null) {
            return false;
        }
        return MessageDigest.isEqual(secretBytes, provided.getBytes(StandardCharsets.UTF_8));
    }
}
