package io.restaurantos.purchasing.adapter;

import io.restaurantos.purchasing.feign.InventoryGrnClient;
import io.restaurantos.purchasing.port.GrnDataPort;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.Optional;
import java.util.UUID;

/**
 * Feign-backed GRN adapter for {@code integration-mode=feign} (Phase 8).
 */
@Component
@ConditionalOnProperty(name = "restaurantos.inventory.integration-mode", havingValue = "feign")
public class InventoryGrnClientAdapter implements GrnDataPort {

    private final InventoryGrnClient inventoryGrnClient;

    public InventoryGrnClientAdapter(InventoryGrnClient inventoryGrnClient) {
        this.inventoryGrnClient = inventoryGrnClient;
    }

    @Override
    public Optional<GrnSummary> getSummary(UUID poLineId) {
        InventoryGrnClient.GrnSummaryResponse response = inventoryGrnClient.getGrnSummary(poLineId);
        if (response == null) {
            return Optional.empty();
        }
        return Optional.of(new GrnSummary(
                response.poLineId(),
                response.poId(),
                response.grnId(),
                response.receivedQty(),
                response.orderedQty(),
                response.receivedAt()));
    }
}
