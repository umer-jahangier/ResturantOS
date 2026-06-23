package io.restaurantos.shared.authz;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import io.restaurantos.shared.exception.PermissionDeniedException;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;

import java.util.Map;

/**
 * Fail-closed OPA client: any HTTP error, timeout, or missing OPA_URL results in deny.
 * Optional in dev test harness when OPA_URL is unset (see SharedAutoConfiguration conditional).
 */
public class DefaultOpaClient implements OpaClient {

    private final RestClient restClient;
    private final ObjectMapper objectMapper;

    public DefaultOpaClient(RestClient restClient) {
        this(restClient, opaObjectMapper());
    }

    public DefaultOpaClient(RestClient restClient, ObjectMapper objectMapper) {
        this.restClient = restClient;
        this.objectMapper = objectMapper;
    }

    @Override
    public OpaDecision evaluate(String module, OpaInput input) {
        try {
            String body = objectMapper.writeValueAsString(Map.of("input", input));
            String responseBody = restClient.post()
                .uri("/v1/data/restaurantos/{module}/allow", module)
                .contentType(MediaType.APPLICATION_JSON)
                .body(body)
                .retrieve()
                .body(String.class);
            JsonNode root = objectMapper.readTree(responseBody);
            return new OpaDecision(root.path("result").asBoolean(false));
        } catch (Exception e) {
            // BLR-5: OPA failure = deny. Never default to allow.
            throw new PermissionDeniedException("Authorization service unavailable");
        }
    }

    private static ObjectMapper opaObjectMapper() {
        return new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    }
}
