package io.restaurantos.hr.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.ByteArrayInputStream;
import java.io.IOException;

/**
 * Stops a {@code Content-Type} the device chose from deciding whether an employee gets paid.
 *
 * <h2>The defect</h2>
 *
 * <p>When a POST to {@code /iclock/cdata} declared {@code application/x-www-form-urlencoded}, the
 * servlet container consumed the request body into the parameter map before the handler ran. The
 * body binding then saw an already-drained stream, the handler's null guard skipped the ingest loop,
 * and the device received <b>HTTP 200 with the success acknowledgement and zero rows written, with
 * nothing logged</b>. The terminal then deletes its offline buffer, because as far as it knows the
 * punches were delivered.
 *
 * <p>The documented happy path uses plain text, so a by-the-book firmware never hit it. But firmware
 * varies, the header is chosen by the device, and the consequence is an employee's unpaid hour
 * discovered at month end as a payslip dispute. That is not a risk worth carrying for a guard clause.
 *
 * <h2>The mechanism, and why this one</h2>
 *
 * <p>The body is read to bytes <em>here</em>, before anything can ask for a parameter, and the request
 * is wrapped so the handler gets a fresh stream over those bytes. Prevention rather than
 * reconstruction: rebuilding the body from the parsed parameter map is possible but lossy in exactly
 * the way that matters — an ATTLOG body is tab-delimited text, and round-tripping it through form
 * decoding mangles a line containing {@code =} or {@code &} into something the parser would then
 * reject with no way to tell it had been damaged in transit rather than on the wire.
 *
 * <p>Ordered {@link Ordered#HIGHEST_PRECEDENCE} so it runs before any filter that might touch
 * parameters.
 *
 * <h2>Scoping</h2>
 *
 * <p>Scoped by prefix to the device paths in {@link #shouldNotFilter}, mirroring
 * {@link HrInternalServiceFilter}. Every other endpoint in the service keeps its normal body handling
 * untouched — a filter that buffered every request body would change form handling service-wide to
 * fix one adapter, and would hold arbitrary request bodies in memory on paths that never needed it.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class DeviceBodyPreservingFilter extends OncePerRequestFilter {

    private static final String DEVICE_PREFIX = "/iclock/";

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith(DEVICE_PREFIX);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        byte[] body = request.getInputStream().readAllBytes();
        chain.doFilter(new CachedBodyRequest(request, body), response);
    }

    /**
     * Serves the already-read bytes, and deliberately does NOT contribute them to the parameter map.
     *
     * <p>{@code SN}, {@code token} and {@code table} arrive in the query string on every ADMS call, so
     * the delegate's query-string parsing still answers every parameter the handlers bind. The body is
     * for the ingest path and nothing else.
     */
    private static final class CachedBodyRequest extends HttpServletRequestWrapper {

        private final byte[] body;

        private CachedBodyRequest(HttpServletRequest request, byte[] body) {
            super(request);
            this.body = body;
        }

        @Override
        public ServletInputStream getInputStream() {
            ByteArrayInputStream source = new ByteArrayInputStream(body);
            return new ServletInputStream() {
                @Override
                public int read() {
                    return source.read();
                }

                @Override
                public boolean isFinished() {
                    return source.available() == 0;
                }

                @Override
                public boolean isReady() {
                    return true;
                }

                @Override
                public void setReadListener(ReadListener readListener) {
                    throw new UnsupportedOperationException("Device ingest is read synchronously");
                }
            };
        }

        @Override
        public java.io.BufferedReader getReader() {
            return new java.io.BufferedReader(new java.io.InputStreamReader(
                    getInputStream(), java.nio.charset.StandardCharsets.UTF_8));
        }
    }
}
