package io.restaurantos.authz.integration;

import io.restaurantos.shared.authz.DefaultOpaClient;
import io.restaurantos.shared.authz.OpaInput;
import org.junit.jupiter.api.Test;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class OpaDirectIT extends BaseIntegrationTest {

    @Test
    void opaContainerEvaluatesPosVoidAny() {
        RestClient restClient = RestClient.builder().baseUrl(opaBaseUrl()).build();
        var client = new DefaultOpaClient(restClient);
        OpaInput input = OpaInput.builder()
            .user(new OpaInput.User(
                TestFixtures.cashierUserId(),
                TestFixtures.demoTenantId(),
                TestFixtures.mainBranchId(),
                List.of("pos.order.void.any"),
                Map.of()))
            .resource(new OpaInput.Resource(
                "order",
                UUID.randomUUID(),
                TestFixtures.demoTenantId(),
                TestFixtures.mainBranchId(),
                TestFixtures.cashierUserId(),
                "OPEN",
                null))
            .action("void")
            .build();
        assertThat(client.evaluate("pos", input).allow()).isTrue();
    }
}
