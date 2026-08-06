package io.restaurantos.user.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import feign.Response;
import feign.codec.ErrorDecoder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Set;

/**
 * Turns a non-2xx response from auth-service {@code /internal/auth/**} into an exception that says
 * what actually happened.
 *
 * <h2>Why this file exists</h2>
 *
 * <p>Feign's {@link ErrorDecoder.Default} raises {@code FeignException}, which is an ordinary
 * {@code RuntimeException} as far as {@code GlobalExceptionHandler} is concerned — so every upstream
 * refusal fell into {@code handleUnexpected} and came back to the client as {@code 500
 * INTERNAL_ERROR}. Two security refusals were being hidden that way, both measured live:
 *
 * <pre>
 *   internal: POST /internal/auth/users/{id}/branch-roles {"roleCode":"NOT_A_REAL_ROLE"} → 400 UNKNOWN_ROLE_CODE
 *   public:   POST /api/v1/users/{id}/branch-roles         same body                     → 500 INTERNAL_ERROR
 *
 *   internal: POST /internal/auth/users/{id}/branch-roles {"roleCode":"OWNER"}           → 403 ROLE_CEILING_EXCEEDED
 *   public:   POST /api/v1/users/{id}/branch-roles         same body                     → 500 INTERNAL_ERROR
 * </pre>
 *
 * <p>Both refusals were correct and fail-closed; only their <em>status</em> was wrong. That is worse
 * than it sounds: a privilege-escalation attempt and a database outage looked identical to the
 * caller, and identical on a dashboard.
 *
 * <h2>The three rules it follows</h2>
 *
 * <ol>
 *   <li><b>A 4xx keeps its status and its {@code error.code}.</b> The upstream decided what to say;
 *       repeating it verbatim is what makes the public surface behave like the internal one.</li>
 *   <li><b>A 5xx never becomes a 4xx.</b> {@link UpstreamServiceException} always answers 502.
 *       Downgrading a server fault to a client fault tells the caller to fix a correct request and
 *       hides an outage from every 5xx alert.</li>
 *   <li><b>Nothing internal leaks.</b> Only the upstream's own structured {@code error.message}
 *       crosses — never {@code FeignException.getMessage()} (which names the internal host, port and
 *       path), never a raw body, never a stack trace. Undecodable bodies produce a fixed message.
 *       The detail is logged against the trace id instead.</li>
 * </ol>
 *
 * <h2>The refusals that are ours, not the caller's</h2>
 *
 * <p>Three upstream 4xx codes are deliberately <em>not</em> passed through, because they do not
 * describe anything the caller did or can change — they describe user-service being misconfigured:
 *
 * <ul>
 *   <li>{@code 401} — the {@code X-Internal-Service} secret was rejected;</li>
 *   <li>{@code 403 INTERNAL_AUTH_REQUIRED} — the secret was not sent at all;</li>
 *   <li>{@code 403 ACTING_USER_REQUIRED} — user-service failed to forward the caller's identity
 *       (13-11 made that header mandatory precisely so its absence could not fail open).</li>
 * </ul>
 *
 * <p>Echoing them would tell an authenticated tenant admin to log in again, or to go and obtain an
 * authority, in response to a fault they cannot see and cannot fix. They are server faults and read
 * as 502, loudly, in our own logs.
 */
public class UpstreamErrorDecoder implements ErrorDecoder {

    private static final Logger log = LoggerFactory.getLogger(UpstreamErrorDecoder.class);

    /**
     * Upstream {@code error.code}s at 403 that mean "user-service called us wrongly", not
     * "the caller may not do this". See the class comment.
     */
    private static final Set<String> OUR_FAULT_AT_403 =
        Set.of("INTERNAL_AUTH_REQUIRED", "ACTING_USER_REQUIRED");

    /**
     * Read at most this much of an error body. An error body is a small JSON object; anything
     * larger is not one, and reading it wholesale into memory on an error path is how a broken
     * upstream becomes an outage here too.
     */
    private static final int MAX_BODY_BYTES = 16 * 1024;

    private final ObjectMapper objectMapper;

    public UpstreamErrorDecoder(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    public Exception decode(String methodKey, Response response) {
        int status = response.status();
        String body = readBody(response);
        String code = jsonField(body, "code");
        String message = jsonField(body, "message");

        boolean clientError = status >= 400 && status < 500;
        boolean ourFault = status == 401 || (status == 403 && code != null && OUR_FAULT_AT_403.contains(code));

        if (clientError && !ourFault) {
            log.info("Upstream {} answered {} {} for {}", targetOf(methodKey), status, code, methodKey);
            return new UpstreamClientException(
                status,
                code != null ? code : "UPSTREAM_REJECTED",
                message != null ? message : "The request was rejected by an internal service");
        }

        // Everything else — 5xx, 3xx, 1xx, and the 4xx family above — is a fault on our side of
        // the seam. The body is logged, never returned.
        log.error("Upstream call {} failed: status={} code={} body={}", methodKey, status, code, body);
        return new UpstreamServiceException(
            "Upstream call %s failed with status %d (code=%s)".formatted(methodKey, status, code));
    }

    /** The declaring interface, for a log line that names the seam rather than the whole signature. */
    private static String targetOf(String methodKey) {
        int hash = methodKey.indexOf('#');
        return hash > 0 ? methodKey.substring(0, hash) : methodKey;
    }

    /**
     * Reads the error body defensively. A body that cannot be read is not an error worth
     * propagating — the status is what matters, and losing the body must not turn a 403 into an
     * exception thrown out of the error decoder itself.
     */
    private static String readBody(Response response) {
        if (response.body() == null) return "";
        try (InputStream in = response.body().asInputStream()) {
            byte[] bytes = in.readNBytes(MAX_BODY_BYTES);
            return new String(bytes, StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
        }
    }

    /**
     * Pulls one field out of the platform error envelope {@code {"error":{code,message,...}}}.
     * Returns null for anything that is not that shape — an HTML error page from a proxy, an empty
     * body, a truncated one — so the caller falls back to a fixed message rather than echoing
     * whatever arrived.
     */
    private String jsonField(String body, String field) {
        if (body == null || body.isBlank()) return null;
        try {
            JsonNode error = objectMapper.readTree(body).path("error").path(field);
            return error.isTextual() && !error.asText().isBlank() ? error.asText() : null;
        } catch (Exception e) {
            return null;
        }
    }
}
