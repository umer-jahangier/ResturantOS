package io.restaurantos.file.config;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link FileInternalServiceFilter} is the ONLY authentication on {@code /internal/**} —
 * {@code FileSecurityConfig} deliberately marks that path {@code permitAll()} to Spring Security
 * because service-to-service calls carry no user principal. So every refusal this filter fails to
 * make is an unauthenticated read of another tenant's file metadata and bytes.
 *
 * <p>The tests exercise the PUBLIC {@code doFilter} entry point rather than the protected
 * {@code doFilterInternal}, because {@code shouldNotFilter} is half the security decision: a bug
 * that widens the URI prefix disables the secret check entirely and would be invisible to a test
 * that called {@code doFilterInternal} directly.
 *
 * <p>The header name is spelled out as a literal here instead of read from
 * {@link FileInternalServiceFilter#HEADER}. Using the constant would make every test tautological:
 * renaming the wire header would keep them all green while every caller in the mesh broke.
 */
class FileInternalServiceFilterTest {

    /** Matches the {@code @Value} default in the constructor. 19 bytes — length matters below. */
    private static final String SECRET = "dev-internal-secret";

    private static final String WIRE_HEADER = "X-Internal-Service";

    /**
     * The exact refusal body. Callers (and the fleet's log greps) key on {@code code}, so this is
     * asserted whole rather than by {@code contains}: a reworded message is a contract change.
     */
    private static final String REFUSAL_BODY =
            "{\"error\":{\"code\":\"INTERNAL_AUTH_REQUIRED\","
                    + "\"message\":\"Missing or invalid X-Internal-Service secret\"}}";

    private FileInternalServiceFilter filter;
    private MockHttpServletResponse response;
    private MockFilterChain chain;

    @BeforeEach
    void setUp() {
        filter = new FileInternalServiceFilter(SECRET);
        response = new MockHttpServletResponse();
        chain = new MockFilterChain();
    }

    private static MockHttpServletRequest request(String method, String uri) {
        return new MockHttpServletRequest(method, uri);
    }

    /** Every assertion a refusal must satisfy, in one place. */
    private void assertRefused() throws Exception {
        assertThat(response.getStatus()).isEqualTo(403);
        assertThat(response.getContentType()).isEqualTo("application/json");
        assertThat(response.getContentAsString()).isEqualTo(REFUSAL_BODY);
        assertThat(chain.getRequest())
                .as("a refused request must never reach the controller chain")
                .isNull();
    }

    // ── Refusals ────────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("no X-Internal-Service header at all is a 403 INTERNAL_AUTH_REQUIRED")
    void missingHeaderIsRefused() throws Exception {
        MockHttpServletRequest req = request("GET", "/internal/files/abc");

        filter.doFilter(req, response, chain);

        assertRefused();
    }

    /**
     * Each value is a near-miss that a sloppier comparison could let through: a prefix, a
     * superstring, a case fold, whitespace padding, and the empty header a proxy leaves behind
     * when it strips a value but keeps the name.
     */
    @ParameterizedTest(name = "secret \"{0}\" is refused")
    @ValueSource(strings = {
            "",                       // header present, value stripped
            " ",
            "wrong",
            "dev-internal-secre",     // one byte short — a prefix of the real secret
            "dev-internal-secrett",   // one byte long — real secret is a prefix of this
            "dev-internal-secret ",   // trailing space
            " dev-internal-secret",   // leading space
            "DEV-INTERNAL-SECRET",    // the secret is case-SENSITIVE, unlike the header name
            "dev_internal_secret"
    })
    void wrongSecretIsRefused(String provided) throws Exception {
        MockHttpServletRequest req = request("GET", "/internal/files/abc");
        req.addHeader(WIRE_HEADER, provided);

        filter.doFilter(req, response, chain);

        assertRefused();
    }

    @ParameterizedTest(name = "{0} /internal/** is guarded")
    @ValueSource(strings = {"GET", "POST", "PUT", "PATCH", "DELETE"})
    void theGuardIsVerbAgnostic(String method) throws Exception {
        MockHttpServletRequest req = request(method, "/internal/files/abc/content");

        filter.doFilter(req, response, chain);

        assertRefused();
    }

    @Test
    @DisplayName("a deep /internal path is guarded, not just the collection root")
    void nestedInternalPathIsGuarded() throws Exception {
        MockHttpServletRequest req = request(
                "GET", "/internal/files/00000000-0000-0000-0000-000000000001/content");

        filter.doFilter(req, response, chain);

        assertRefused();
    }

    // ── Acceptance ──────────────────────────────────────────────────────────────────────────

    @Test
    void correctSecretReachesTheChainUntouched() throws Exception {
        MockHttpServletRequest req = request("GET", "/internal/files/abc");
        req.addHeader(WIRE_HEADER, SECRET);

        filter.doFilter(req, response, chain);

        assertThat(chain.getRequest()).isSameAs(req);
        assertThat(chain.getResponse()).isSameAs(response);
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getContentAsString())
                .as("the filter must not write to the body of a request it accepts")
                .isEmpty();
    }

    /**
     * HTTP header names are case-insensitive on the wire, and the container normalises them.
     * This pins that the filter delegates to {@code getHeader} rather than scanning
     * {@code getHeaderNames()} itself with an equals — a refactor that would 403 every caller
     * whose HTTP client lower-cases headers (HTTP/2 mandates it).
     */
    @Test
    void headerNameIsMatchedCaseInsensitively() throws Exception {
        MockHttpServletRequest req = request("GET", "/internal/files/abc");
        req.addHeader("x-internal-service", SECRET);

        filter.doFilter(req, response, chain);

        assertThat(chain.getRequest()).isSameAs(req);
        assertThat(response.getStatus()).isEqualTo(200);
    }

    /**
     * The constructor encodes with UTF-8 and so does the check. If one side ever changes to
     * platform default or ISO-8859-1, a non-ASCII secret stops matching itself and every internal
     * call in the mesh 403s at once — with a message blaming the caller.
     */
    @Test
    void nonAsciiSecretMatchesItself() throws Exception {
        String unicodeSecret = "sécret-ünïcøde-Ω";
        FileInternalServiceFilter unicodeFilter = new FileInternalServiceFilter(unicodeSecret);
        MockHttpServletRequest req = request("GET", "/internal/files/abc");
        req.addHeader(WIRE_HEADER, unicodeSecret);

        unicodeFilter.doFilter(req, response, chain);

        assertThat(chain.getRequest()).isSameAs(req);
        assertThat(response.getStatus()).isEqualTo(200);
    }

    @Test
    @DisplayName("accepting one request grants nothing to the next one")
    void authorisationDoesNotLeakAcrossRequests() throws Exception {
        MockHttpServletRequest authorised = request("GET", "/internal/files/abc");
        authorised.addHeader(WIRE_HEADER, SECRET);
        filter.doFilter(authorised, response, chain);
        assertThat(response.getStatus()).isEqualTo(200);

        // Same filter instance, fresh request with no header.
        response = new MockHttpServletResponse();
        chain = new MockFilterChain();
        filter.doFilter(request("GET", "/internal/files/abc"), response, chain);

        assertRefused();
    }

    // ── Scope of the guard ──────────────────────────────────────────────────────────────────

    /**
     * Paths outside {@code /internal/} carry no secret and must still pass — they are gated by
     * the JWT filter that runs after this one. {@code "/internal"} with no trailing slash and
     * {@code "/internals/..."} are the two prefix boundaries: both are OUTSIDE the guard, so
     * anything mapped at exactly {@code /internal} would be unauthenticated. Nothing is mapped
     * there today ({@code InternalFileController} is {@code /internal/files}); this test exists so
     * that adding such a mapping breaks a test instead of shipping open.
     */
    @ParameterizedTest(name = "\"{0}\" is outside the internal guard")
    @ValueSource(strings = {
            "/api/v1/files/abc",
            "/actuator/health",
            "/actuator/prometheus",
            "/internal",              // boundary: prefix is "/internal/", so this is NOT guarded
            "/internals/files/abc",   // boundary: longer segment, NOT guarded
            "/api/v1/internal/files", // the prefix must be anchored at the start
            "/"
    })
    void nonInternalPathsPassWithoutASecret(String uri) throws Exception {
        MockHttpServletRequest req = request("GET", uri);

        filter.doFilter(req, response, chain);

        assertThat(chain.getRequest())
                .as("%s must not be short-circuited by the internal-secret filter", uri)
                .isSameAs(req);
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getContentAsString()).isEmpty();
    }

    /**
     * {@code /internal/} exactly — the shortest URI the guard covers. Pinned separately from the
     * refusal cases above because it is the boundary on the guarded side of the {@code startsWith}.
     */
    @Test
    void theBareInternalPrefixIsInsideTheGuard() throws Exception {
        MockHttpServletRequest req = request("GET", "/internal/");

        filter.doFilter(req, response, chain);

        assertRefused();
    }

    /**
     * The constant is public and read by whatever builds outbound internal calls; the tests above
     * deliberately hard-code the literal, so this is the single place the two are tied together.
     */
    @Test
    void headerConstantIsTheWireName() {
        assertThat(FileInternalServiceFilter.HEADER).isEqualTo(WIRE_HEADER);
    }
}
