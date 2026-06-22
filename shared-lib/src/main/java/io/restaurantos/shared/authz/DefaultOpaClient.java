package io.restaurantos.shared.authz;

import io.restaurantos.shared.exception.PermissionDeniedException;
import org.springframework.web.client.RestClient;

/**
 * Fail-closed OPA client: any HTTP error, timeout, or missing OPA_URL results in deny.
 * Optional in dev test harness when OPA_URL is unset (see SharedAutoConfiguration conditional).
 */
public class DefaultOpaClient implements OpaClient {

    private final RestClient restClient; // baseUrl = OPA_URL
    public DefaultOpaClient(RestClient restClient) { this.restClient = restClient; }

    @Override
    public OpaDecision evaluate(String module, OpaInput input) {
        try {
            OpaResponse resp = restClient.post()
                .uri("/v1/data/restaurantos/{module}/allow", module)
                .body(new OpaRequest(input))
                .retrieve()
                .body(OpaResponse.class);
            return new OpaDecision(resp != null && Boolean.TRUE.equals(resp.result()));
        } catch (Exception e) {
            // BLR-5: OPA failure = deny. Never default to allow.
            throw new PermissionDeniedException("Authorization service unavailable");
        }
    }

    private record OpaRequest(OpaInput input) {}
    private record OpaResponse(Boolean result) {}
}
