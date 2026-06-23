package io.restaurantos.authz.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import io.restaurantos.shared.authz.OpaInput;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class OpaInputSerializationTest {

    private final ObjectMapper mapper = new ObjectMapper().registerModule(new JavaTimeModule());

    @Test
    void serializesUserAndResourceWithSnakeCase() throws Exception {
        OpaInput input = OpaInput.builder()
            .user(new OpaInput.User(
                UUID.fromString("c0000001-0000-4000-8000-000000000001"),
                UUID.fromString("a0000001-0000-4000-8000-000000000001"),
                UUID.fromString("b0000001-0000-4000-8000-000000000001"),
                List.of("pos.order.void.any"),
                Map.of()))
            .resource(new OpaInput.Resource(
                "order",
                UUID.randomUUID(),
                UUID.fromString("a0000001-0000-4000-8000-000000000001"),
                UUID.fromString("b0000001-0000-4000-8000-000000000001"),
                UUID.fromString("c0000001-0000-4000-8000-000000000001"),
                "OPEN",
                null))
            .action("void")
            .environment(new OpaInput.Environment(Instant.parse("2026-01-01T00:00:00Z"), null))
            .build();

        JsonNode json = mapper.valueToTree(input);
        assertThat(json.path("user").path("tenant_id").asText())
            .isEqualTo("a0000001-0000-4000-8000-000000000001");
        assertThat(json.path("resource").path("branch_id").asText())
            .isEqualTo("b0000001-0000-4000-8000-000000000001");
    }
}
