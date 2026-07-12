package io.restaurantos.purchasing.opa;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import io.restaurantos.purchasing.feign.AuthorizationClient;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.authz.OpaInput;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.time.Instant;
import java.util.Map;

/**
 * Real-OPA-backed {@link AuthorizationClient} test double (10-08 — standing lesson 10-06-A: a
 * test that mocks the thing that broke proves nothing).
 *
 * <p>Reproduces exactly what {@code AuthorizeService.authorize()} / {@code DefaultOpaClient}
 * do in production: builds a snake_case {@link OpaInput} from the caller's identity (held in a
 * mutable {@link TestPrincipal} so a test can switch approver identity between calls) and the
 * service's own {@code AuthorizePayload} (action string passed through with ZERO rewriting),
 * then POSTs it straight to a real OPA server evaluating the real {@code policies/} bundle at
 * {@code /v1/data/restaurantos/{module}/allow}. No mocking anywhere in this path — the rego
 * decides allow/deny for real.
 */
public class OpaBackedAuthorizationClient implements AuthorizationClient {

    private final RestClient rest;
    private final ObjectMapper objectMapper;
    private final TestPrincipal principal;

    public OpaBackedAuthorizationClient(String opaBaseUrl, TestPrincipal principal) {
        this.rest = RestClient.builder()
                .baseUrl(opaBaseUrl)
                .requestFactory(new JdkClientHttpRequestFactory())
                .build();
        this.objectMapper = new ObjectMapper()
                .registerModule(new JavaTimeModule())
                .setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
                .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        this.principal = principal;
    }

    @Override
    public ApiResponse<AuthorizeResult> authorize(AuthorizePayload payload) {
        OpaInput input = OpaInput.builder()
                .user(new OpaInput.User(
                        principal.userId(), principal.tenantId(), principal.branchId(),
                        principal.permissions(), principal.attributes()))
                .resource(new OpaInput.Resource(
                        payload.resource().type(), payload.resource().id(),
                        payload.resource().tenantId(), payload.resource().branchId(),
                        payload.resource().createdBy(), payload.resource().status(),
                        payload.resource().amountPaisa()))
                .action(payload.action())
                .environment(new OpaInput.Environment(Instant.now(), null))
                .build();
        try {
            String body = objectMapper.writeValueAsString(Map.of("input", input));
            String responseBody = rest.post()
                    .uri("/v1/data/restaurantos/{module}/allow", payload.module())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .body(String.class);
            JsonNode root = objectMapper.readTree(responseBody);
            // Fail-closed on an undefined/absent document, mirroring DefaultOpaClient.
            boolean allow = root.path("result").asBoolean(false);
            return ApiResponse.ok(new AuthorizeResult(allow, null));
        } catch (Exception e) {
            return ApiResponse.ok(new AuthorizeResult(false, "opa_error: " + e.getMessage()));
        }
    }
}
