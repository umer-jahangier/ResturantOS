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
    /**
     * mock = use mock_grn_receipts table for GRN data and an Uncategorized-only fallback for
     * spend-analytics category resolution; feign = call inventory-service for both GRN summaries
     * (Phase 8) and ingredient-category lookups (08.2-11) alike.
     */
    private String integrationMode = "mock";

    public boolean isMockMode() {
        return "mock".equalsIgnoreCase(integrationMode);
    }
}
