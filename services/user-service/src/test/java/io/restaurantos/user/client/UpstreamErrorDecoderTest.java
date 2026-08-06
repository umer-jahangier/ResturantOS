package io.restaurantos.user.client;

import com.fasterxml.jackson.databind.ObjectMapper;
import feign.Request;
import feign.RequestTemplate;
import feign.Response;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Collections;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The decoder that stopped auth-service's security refusals arriving at the client as 500s.
 *
 * <p>Every case here has a control: a status that must pass through is paired with one that must
 * not, so "everything becomes a 4xx" and "everything becomes a 502" both fail.
 */
class UpstreamErrorDecoderTest {

    private final UpstreamErrorDecoder decoder = new UpstreamErrorDecoder(new ObjectMapper());

    private static final String METHOD_KEY = "AuthInternalClient#assignBranchRole(UUID,UUID,UUID,BranchRoleRequest)";

    private static Response response(int status, String body) {
        return Response.builder()
            .status(status)
            .reason("reason")
            .request(Request.create(Request.HttpMethod.POST,
                "http://127.0.0.1:8081/internal/auth/users/x/branch-roles",
                Collections.emptyMap(), null, StandardCharsets.UTF_8, new RequestTemplate()))
            .body(body, StandardCharsets.UTF_8)
            .build();
    }

    private static String errorBody(String code, String message) {
        return "{\"error\":{\"code\":\"%s\",\"message\":\"%s\",\"details\":[],\"traceId\":\"t\"}}"
            .formatted(code, message);
    }

    // ── 4xx keeps its status and its code ────────────────────────────────────────────────────

    @Test
    void unknownRoleCode_keepsIts400AndItsCode() {
        Exception e = decoder.decode(METHOD_KEY,
            response(400, errorBody("UNKNOWN_ROLE_CODE", "Unknown role code: NOT_A_REAL_ROLE")));

        assertThat(e).isInstanceOf(UpstreamClientException.class);
        UpstreamClientException ex = (UpstreamClientException) e;
        assertThat(ex.status()).isEqualTo(400);
        assertThat(ex.code()).isEqualTo("UNKNOWN_ROLE_CODE");
        assertThat(ex.getMessage()).isEqualTo("Unknown role code: NOT_A_REAL_ROLE");
    }

    @Test
    void roleCeilingExceeded_keepsIts403AndItsCode() {
        Exception e = decoder.decode(METHOD_KEY, response(403, errorBody("ROLE_CEILING_EXCEEDED",
            "You cannot assign the role OWNER: it grants 1 permission(s) you do not hold yourself")));

        assertThat(e).isInstanceOf(UpstreamClientException.class);
        assertThat(((UpstreamClientException) e).status()).isEqualTo(403);
        assertThat(((UpstreamClientException) e).code()).isEqualTo("ROLE_CEILING_EXCEEDED");
    }

    @Test
    void crossTenantNotFound_keepsIts404() {
        Exception e = decoder.decode(METHOD_KEY, response(404, errorBody("NOT_FOUND", "User not found")));

        assertThat(e).isInstanceOf(UpstreamClientException.class);
        assertThat(((UpstreamClientException) e).status()).isEqualTo(404);
    }

    @Test
    void duplicateEmail_keepsIts409() {
        Exception e = decoder.decode(METHOD_KEY,
            response(409, errorBody("STATE_INVALID", "A user with that email already exists in this tenant")));

        assertThat(((UpstreamClientException) e).status()).isEqualTo(409);
        assertThat(((UpstreamClientException) e).code()).isEqualTo("STATE_INVALID");
    }

    // ── a 5xx must never become a 4xx ────────────────────────────────────────────────────────

    @Test
    void upstream500_isAServiceFault_notAClientFault() {
        Exception e = decoder.decode(METHOD_KEY, response(500, errorBody("INTERNAL_ERROR", "An unexpected error occurred")));

        assertThat(e).isInstanceOf(UpstreamServiceException.class);
        assertThat(e).isNotInstanceOf(UpstreamClientException.class);
    }

    @Test
    void upstream503_isAServiceFault() {
        assertThat(decoder.decode(METHOD_KEY, response(503, "")))
            .isInstanceOf(UpstreamServiceException.class);
    }

    // ── the 4xx that are OUR fault, not the caller's ─────────────────────────────────────────

    @Test
    void internalSecretRejected_isNotEchoedAsA401() {
        // A 401 here means user-service's shared secret is wrong. Telling an authenticated tenant
        // admin to log in again would be a lie about a fault they cannot see.
        assertThat(decoder.decode(METHOD_KEY, response(401, errorBody("UNAUTHENTICATED", "Invalid token"))))
            .isInstanceOf(UpstreamServiceException.class);
    }

    @Test
    void actingUserRequired_isNotEchoedAsA403() {
        // 13-11 made X-Acting-User-Id mandatory. Its absence is user-service failing to forward the
        // caller's identity — not the caller lacking an authority.
        assertThat(decoder.decode(METHOD_KEY,
            response(403, errorBody("ACTING_USER_REQUIRED", "POST /internal/auth/users requires X-Acting-User-Id"))))
            .isInstanceOf(UpstreamServiceException.class);
    }

    @Test
    void internalAuthRequired_isNotEchoedAsA403() {
        assertThat(decoder.decode(METHOD_KEY,
            response(403, errorBody("INTERNAL_AUTH_REQUIRED", "Missing X-Internal-Service"))))
            .isInstanceOf(UpstreamServiceException.class);
    }

    // ── nothing internal leaks ───────────────────────────────────────────────────────────────

    @Test
    void theClientFacingMessageNeverNamesTheInternalHostOrPath() {
        Exception e = decoder.decode(METHOD_KEY, response(403, errorBody("ROLE_CEILING_EXCEEDED", "You cannot assign the role OWNER")));

        assertThat(e.getMessage())
            .doesNotContain("127.0.0.1")
            .doesNotContain("8081")
            .doesNotContain("/internal/auth")
            .doesNotContain("AuthInternalClient");
    }

    @Test
    void anUndecodableBodyIsNotEchoed() {
        // An HTML error page from a proxy, or a truncated body. The status is still honoured; the
        // body is not repeated at the client, because we cannot know what is in it.
        Exception e = decoder.decode(METHOD_KEY,
            response(400, "<html><body>nginx: upstream sent too big header, secret=hunter2</body></html>"));

        assertThat(e).isInstanceOf(UpstreamClientException.class);
        assertThat(((UpstreamClientException) e).status()).isEqualTo(400);
        assertThat(((UpstreamClientException) e).code()).isEqualTo("UPSTREAM_REJECTED");
        assertThat(e.getMessage()).doesNotContain("hunter2").doesNotContain("nginx");
    }

    @Test
    void anEmptyBodyDoesNotThrowOutOfTheDecoder() {
        Exception e = decoder.decode(METHOD_KEY, response(400, ""));

        assertThat(e).isInstanceOf(UpstreamClientException.class);
        assertThat(((UpstreamClientException) e).code()).isEqualTo("UPSTREAM_REJECTED");
    }

    @Test
    void aNullBodyDoesNotThrowOutOfTheDecoder() {
        Response r = Response.builder()
            .status(403)
            .request(Request.create(Request.HttpMethod.GET, "http://127.0.0.1:8081/internal/auth/users",
                Collections.emptyMap(), null, StandardCharsets.UTF_8, new RequestTemplate()))
            .build();

        assertThat(decoder.decode(METHOD_KEY, r)).isInstanceOf(UpstreamClientException.class);
    }
}
