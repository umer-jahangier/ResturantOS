package io.restaurantos.hr.config;

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

@Component
public class HrInternalServiceFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Internal-Service";

    /**
     * Mode B device ingest carries its own device-token authentication (see
     * {@code AttendanceIngestController}) and is deliberately NOT protected by the internal-service
     * secret: the gateway's {@code StripInternalHeaderFilter} removes {@code X-Internal-Service} from
     * every inbound request unconditionally, so requiring it here made this endpoint return 403
     * {@code INTERNAL_AUTH_REQUIRED} 100% of the time through the gateway — the USB-bridge path could
     * never work. Excluded here; authentication is enforced by
     * {@code DeviceAuthResolver.resolve(serial, token)} inside the controller.
     */
    static final String DEVICE_INGEST_PATH = "/internal/attendance/ingest";

    private final byte[] secretBytes;

    public HrInternalServiceFilter(
            @Value("${restaurantos.internal.secret:dev-internal-secret}") String secret) {
        this.secretBytes = secret.getBytes(StandardCharsets.UTF_8);
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String uri = request.getRequestURI();
        return !uri.startsWith("/internal/") || DEVICE_INGEST_PATH.equals(uri);
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
                    "{\"error\":{\"code\":\"INTERNAL_AUTH_REQUIRED\",\"message\":\"Missing or invalid X-Internal-Service secret\"}}");
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
