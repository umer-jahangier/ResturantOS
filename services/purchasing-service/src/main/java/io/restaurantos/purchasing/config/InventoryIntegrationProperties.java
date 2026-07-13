package io.restaurantos.purchasing.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Getter
@Setter
@Component
@ConfigurationProperties(prefix = "restaurantos.inventory")
public class InventoryIntegrationProperties {
    /** mock = use mock_grn_receipts table; feign = call inventory-service (Phase 8). */
    private String integrationMode = "mock";

    public boolean isMockMode() {
        return "mock".equalsIgnoreCase(integrationMode);
    }
}
