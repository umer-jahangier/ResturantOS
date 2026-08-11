package io.restaurantos.inventory;

import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.context.WebApplicationContext;

import java.io.IOException;

/**
 * Binds {@link TenantContext} from the authenticated principal for the duration of a MockMvc
 * request — the job {@code JwtAuthenticationFilter} does in production from a Bearer token.
 *
 * <h2>Why this exists</h2>
 *
 * <p>These tests used to set the tenant once in {@code @BeforeEach} and rely on the ThreadLocal
 * surviving every {@code perform()} in the method. It did, because {@code JwtAuthenticationFilter}
 * returned early for a tokenless request without reaching the {@code finally} that clears. That
 * early return was a live cross-tenant read in production: an {@code /internal/**} call
 * authenticated by shared secret set the context and nothing unset it, so the next request on the
 * same Tomcat worker inherited that tenant. Fixing it (f72e012) meant the first {@code perform()}
 * in each test cleared the context and every later one ran with none — 124 occurrences of
 * "TenantContext is empty" across 10 IT classes in this module alone.
 *
 * <p>The tests were wrong, not the fix. Production never promised a ThreadLocal would outlive a
 * request, so a test that depended on it was asserting against a guarantee that did not exist.
 *
 * <h2>Why it binds from the principal rather than being handed a tenant id</h2>
 *
 * <p>A test that seeds context by hand cannot notice the real binding breaking. This reads
 * {@link JwtClaims} off the {@code Authentication} exactly as production reads it off the verified
 * token, so the tenant a request runs under is derived from the identity the request carries.
 *
 * <h2>Why it RESTORES on exit and production CLEARS</h2>
 *
 * <p>Not an inconsistency, and the distinction matters. In production, restoring a snapshot would
 * faithfully reinstate the leaked state the clear exists to destroy — it would turn a real
 * guarantee back into a fiction. Here the value being restored is not leaked: it is the test
 * thread's own fixture scope, set by {@code @BeforeEach} so that direct service and repository
 * calls between requests have a tenant. The request borrows the thread and gives it back as it
 * found it. Requests still cannot see each other's context, which is the property under test.
 */
final class TenantContextBindingTestFilter implements Filter {

    private final TenantContext tenantContext;

    private TenantContextBindingTestFilter(TenantContext tenantContext) {
        this.tenantContext = tenantContext;
    }

    static TenantContextBindingTestFilter from(WebApplicationContext context) {
        return new TenantContextBindingTestFilter(context.getBean(TenantContext.class));
    }

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        TenantContext.TenantSnapshot outside = tenantContext.snapshot();
        try {
            claims().ifPresent(c -> {
                if (c.tenantId() != null) {
                    tenantContext.set(c.tenantId(), c.branchId(), c.subject(), c.impersonatedBy());
                }
            });
            chain.doFilter(request, response);
        } finally {
            tenantContext.restore(outside);
        }
    }

    private static java.util.Optional<JwtClaims> claims() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof JwtClaims c)) {
            return java.util.Optional.empty();
        }
        return java.util.Optional.of(c);
    }
}
