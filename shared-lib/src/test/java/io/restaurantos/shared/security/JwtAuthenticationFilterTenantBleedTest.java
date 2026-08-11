package io.restaurantos.shared.security;

import io.restaurantos.shared.tenant.ThreadLocalTenantContext;
import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * A request that carries no Bearer token must still leave the worker thread clean.
 *
 * <h2>The defect this pins</h2>
 *
 * {@code doFilterInternal} early-returned on a missing or non-Bearer {@code Authorization} header,
 * and that return path skipped the {@code finally} block that calls {@code tenantContext.clear()}.
 * The clear existed, was correct, and ran only for requests that had a token.
 *
 * <p>Which is exactly the wrong way round for the requests that matter here. The {@code /internal/**}
 * endpoints authenticate with a shared secret rather than a JWT, so they take the early return —
 * and {@code BranchInternalController.setTenantGuc} calls {@code tenantContext.set(..)} itself from
 * the {@code X-Tenant-Id} header. Nothing cleared it. The thread returned to Tomcat's pool still
 * bound to that tenant, and the next request to land on it inherited the binding.
 *
 * <p>Measured on the live stack, 2026-08-11:
 * {@code GET /internal/users/branches/{id}} with the internal secret and <b>no</b> {@code X-Tenant-Id}
 * returned <b>200 carrying tenant A's branch</b>, immediately after an A-scoped call on the same
 * worker — and 409 when the preceding call differed. One request answering differently depending on
 * what the thread did before it is the signature of leaked thread-local state, and it is a
 * cross-tenant read.
 *
 * <p>It went unseen because it is invisible to a single-request test. Every existing test of this
 * filter drives one request against a fresh thread-local, where "never set" and "set then correctly
 * cleared" are indistinguishable. Only the second request on the same thread can tell them apart,
 * so that is what these tests do.
 *
 * <p>Nothing upstream would have caught it either. Row-level security keys on
 * {@code app.current_tenant_id}, which is set FROM this context — so a stale context does not
 * violate RLS, it silently redirects it. The database faithfully returned tenant A's rows because
 * it was faithfully told the caller was tenant A.
 */
class JwtAuthenticationFilterTenantBleedTest {

    private final ThreadLocalTenantContext tenantContext = new ThreadLocalTenantContext();
    private final JwtAuthenticationFilter filter =
            new JwtAuthenticationFilter(mock(JwksKeyProvider.class), tenantContext);

    @AfterEach
    void tearDown() {
        // Belt and braces: a leaked binding must not escape into a sibling test either.
        tenantContext.clear();
    }

    private HttpServletRequest requestWithoutToken() {
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getHeader("Authorization")).thenReturn(null);
        return request;
    }

    @Test
    void aTokenlessRequestThatBindsATenantMustNotLeaveItBoundAfterwards() throws Exception {
        UUID tenantA = UUID.randomUUID();

        // Stand in for BranchInternalController.setTenantGuc: a downstream component on the
        // tokenless path binds the tenant from a header, mid-chain, exactly as production does.
        FilterChain chain = (req, res) ->
                tenantContext.set(tenantA, null, UUID.randomUUID(), null);

        filter.doFilter(requestWithoutToken(), mock(HttpServletResponse.class), chain);

        assertThat(tenantContext.getTenantId())
                .as("the worker thread must go back to the pool unbound — otherwise the NEXT "
                        + "request on it reads this tenant's rows")
                .isEmpty();
    }

    @Test
    void aSecondTokenlessRequestMustNotInheritTheFirstsTenant() throws Exception {
        UUID tenantA = UUID.randomUUID();

        // Request 1: binds tenant A, as an /internal call carrying X-Tenant-Id would.
        filter.doFilter(requestWithoutToken(), mock(HttpServletResponse.class),
                (req, res) -> tenantContext.set(tenantA, null, UUID.randomUUID(), null));

        // Request 2: same thread, binds nothing — an /internal call with NO X-Tenant-Id.
        // This is the request that returned 200 with tenant A's branch.
        AtomicReference<Optional<UUID>> seenByRequestTwo = new AtomicReference<>();
        filter.doFilter(requestWithoutToken(), mock(HttpServletResponse.class),
                (req, res) -> seenByRequestTwo.set(tenantContext.getTenantId()));

        assertThat(seenByRequestTwo.get())
                .as("a request that names no tenant must see no tenant, whatever ran before it "
                        + "on this thread")
                .isEmpty();
    }

    @Test
    void theContextIsClearedEvenWhenTheChainThrows() throws Exception {
        UUID tenantA = UUID.randomUUID();

        FilterChain exploding = (req, res) -> {
            tenantContext.set(tenantA, null, UUID.randomUUID(), null);
            throw new RuntimeException("downstream blew up");
        };

        try {
            filter.doFilter(requestWithoutToken(), mock(HttpServletResponse.class), exploding);
        } catch (RuntimeException expected) {
            // The exception is not the subject; what the thread is left holding is.
        }

        assertThat(tenantContext.getTenantId())
                .as("a failed request must not be a leakier request — this is why the clear "
                        + "belongs in a finally and not on the happy path")
                .isEmpty();
    }

    @Test
    void theChainStillRunsForATokenlessRequest() throws Exception {
        // The control. Wrapping the early return in try/finally must not have changed whether the
        // request is served — a filter that clears the context by refusing to call the chain would
        // pass all three tests above, and "no /internal endpoint works" is not the fix.
        boolean[] chainRan = {false};

        filter.doFilter(requestWithoutToken(), mock(HttpServletResponse.class),
                (req, res) -> chainRan[0] = true);

        assertThat(chainRan[0])
                .as("a tokenless request must still be served; only its thread-local state changes")
                .isTrue();
    }

    @Test
    void aNonBearerAuthorizationHeaderTakesTheSamePath() throws Exception {
        // Basic auth, an API key, anything not "Bearer " — same early return, same obligation.
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getHeader("Authorization")).thenReturn("Basic dXNlcjpwYXNz");
        UUID tenantA = UUID.randomUUID();

        filter.doFilter(request, mock(HttpServletResponse.class),
                (req, res) -> tenantContext.set(tenantA, null, UUID.randomUUID(), null));

        assertThat(tenantContext.getTenantId())
                .as("the branch condition is `not a Bearer token`, not `no header at all`")
                .isEmpty();
        Mockito.verify(request, Mockito.atLeastOnce()).getHeader(any());
    }
}
