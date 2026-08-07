package io.restaurantos.auth.client;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.time.Duration;
import java.util.Map;
import java.util.UUID;

/**
 * Asks platform-admin-service whether an email/password pair is a platform (SuperAdmin) credential.
 *
 * <h3>Why auth-service calls out at all</h3>
 * <p>PLATFORM-07: only platform-admin-service connects to {@code platform_db}. auth-service cannot
 * read {@code platform_users}, so the unified email-first login cannot answer "is this a SuperAdmin?"
 * locally. It asks over {@code /internal/platform/auth/verify}, authorised by the same
 * {@code X-Internal-Service} shared secret that already authorises the opposite direction.
 *
 * <h3>The password crosses a service boundary here, and that is a real cost</h3>
 * <p>It is stated rather than left to be discovered. The mitigation is not that the hop is
 * "internal" — it is that the hop is <b>the same one the credential already made</b>: today a
 * SuperAdmin's password travels browser → gateway → platform-admin-service. 16a-01 changes the
 * middle hop from gateway to auth-service; it does not add a new class of exposure, and it does not
 * add a new place the password rests, because nothing here logs, caches or persists it. The request
 * record's {@code toString()} is overridden for that reason and the timeouts below are short so a
 * hung peer cannot hold a credential in a socket buffer indefinitely.
 *
 * <h3>What happens when platform-admin-service is down</h3>
 * <p>{@link #verify} returns {@link Verdict#NO_MATCH} and logs at WARN. It does <b>not</b> propagate,
 * and the reasoning is worth keeping: a tenant user's login has nothing to do with the control
 * plane, and an outage in platform-admin-service that took every restaurant's staff offline would
 * convert a control-plane incident into a total one. The cost of failing this way is that a
 * SuperAdmin cannot log in during such an outage — which is already true, since the console they
 * would log in to is the service that is down.
 *
 * <p>Note what this does NOT do: it never turns an outage into a <i>refusal that names a reason</i>.
 * The caller sees the same "no platform match" it sees for a wrong password, so an attacker cannot
 * probe for the control plane's health through the login form.
 */
@Component
public class PlatformCredentialClient {

    private static final Logger log = LoggerFactory.getLogger(PlatformCredentialClient.class);

    /** Header name matching {@code PlatformSecurityConfig.PlatformInternalServiceFilter.HEADER}. */
    private static final String INTERNAL_HEADER = "X-Internal-Service";

    private final RestClient restClient;
    private final String internalSecret;
    private final boolean enabled;

    /**
     * @param baseUri the platform-admin-service origin. Defaults to the Docker/dev service name so a
     *                compose stack works with no extra wiring; overridden by
     *                {@code PLATFORM_ADMIN_SERVICE_URI} elsewhere.
     * @param enabled escape hatch for deployments with no control plane. When false the platform
     *                branch of the unified login is skipped entirely and no call is made — which is
     *                indistinguishable, to a caller, from a platform credential that did not match.
     */
    /**
     * <b>Builds its own {@link RestClient} rather than injecting a {@code RestClient.Builder}.</b>
     * auth-service has no such bean — an earlier draft that autowired one made the whole application
     * context fail to start, caught by {@code UnifiedLoginIT} before it could reach a running
     * service. {@code PlatformSecurityConfig} in platform-admin-service constructs its own the same
     * way, for the same reason.
     */
    public PlatformCredentialClient(
            @Value("${restaurantos.platform-admin-service.uri:http://localhost:8096}") String baseUri,
            @Value("${restaurantos.internal.secret:dev-internal-secret}") String internalSecret,
            @Value("${restaurantos.auth.platform-login-enabled:true}") boolean enabled) {
        // Short, explicit timeouts. A login is a synchronous, user-facing request behind a 2/s rate
        // limit; letting it block on an unreachable peer for the JDK default (infinite connect on
        // some stacks) would turn one dead service into a thread-pool exhaustion in this one.
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(CONNECT_TIMEOUT);
        factory.setReadTimeout(CALL_TIMEOUT);
        this.restClient = RestClient.builder()
            .baseUrl(baseUri.replaceAll("/+$", ""))
            .requestFactory(factory)
            .build();
        this.internalSecret = internalSecret;
        this.enabled = enabled;
    }

    /**
     * @param sourceAddress the human's address, forwarded so the platform audit line names them
     *                      rather than this service
     * @return a match with the platform user's id and role, or {@link Verdict#NO_MATCH}. Never null,
     *         and never throws — see the class javadoc on why an outage is not an error here.
     */
    public Verdict verify(String email, String password, String sourceAddress) {
        if (!enabled) {
            return Verdict.NO_MATCH;
        }
        try {
            Map<?, ?> response = restClient.post()
                .uri("/internal/platform/auth/verify")
                .contentType(MediaType.APPLICATION_JSON)
                .header(INTERNAL_HEADER, internalSecret)
                .header("X-Source-Address", sourceAddress == null ? "" : sourceAddress)
                .body(new VerifyRequest(email, password))
                .retrieve()
                .body(Map.class);

            Object data = response == null ? null : response.get("data");
            if (!(data instanceof Map<?, ?> map) || !Boolean.TRUE.equals(map.get("matched"))) {
                return Verdict.NO_MATCH;
            }
            Object id = map.get("platformUserId");
            Object role = map.get("role");
            if (id == null || role == null) {
                // A "matched" verdict with no identity is a contract violation, not a login. Refuse
                // it rather than minting a token for a null subject.
                log.error("[unified-login] platform verify returned matched=true with no identity; "
                    + "treating as no match");
                return Verdict.NO_MATCH;
            }
            return new Verdict(true, UUID.fromString(id.toString()), role.toString());
        } catch (RuntimeException e) {
            // Deliberately broad: connection refused, read timeout, 5xx, 403 from a rotated secret
            // and a malformed body all mean the same thing to the caller — no platform match, and
            // an operator problem that belongs in a log rather than in a login response.
            log.warn("[unified-login] platform credential check unavailable ({}); continuing with "
                + "tenant candidates only", e.toString());
            return Verdict.NO_MATCH;
        }
    }

    /** {@code platformUserId} and {@code role} are null whenever {@code matched} is false. */
    public record Verdict(boolean matched, UUID platformUserId, String role) {
        public static final Verdict NO_MATCH = new Verdict(false, null, null);
    }

    private record VerifyRequest(String email, String password) {
        @Override
        public String toString() {
            return "VerifyRequest[email=" + email + ", password=<redacted>]";
        }
    }

    /**
     * Short by design; see the class javadoc. Package-visible so the values are reviewable in one
     * place rather than buried as literals in a builder chain.
     *
     * <p>The read timeout has a floor it must clear: platform-admin-service performs a cost-12
     * bcrypt comparison on EVERY path including the refusals, which is ~250ms, and it may also be
     * waiting on Redis for the lockout counter. Five seconds is generous against that and still far
     * below any human's patience for a login.
     */
    static final Duration CALL_TIMEOUT = Duration.ofSeconds(5);

    static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(2);
}
