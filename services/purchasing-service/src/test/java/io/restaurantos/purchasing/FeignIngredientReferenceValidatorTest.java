package io.restaurantos.purchasing;

import io.restaurantos.purchasing.adapter.FeignIngredientReferenceValidator;
import io.restaurantos.purchasing.exception.IngredientNotInTenantException;
import io.restaurantos.purchasing.feign.InventoryCategoryClient;
import io.restaurantos.purchasing.feign.InventoryCategoryClient.IngredientCategoryResponse;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Unit coverage for the feign-mode ingredient existence guard (T-08.2-044). The mock-mode no-op path
 * is already exercised by every {@code *IT} (all pinned to {@code integration-mode=mock} in {@code
 * PurchasingTestBase}); this proves the authoritative feign path and its degrade-open contract
 * without a Spring context.
 */
class FeignIngredientReferenceValidatorTest {

    private final InventoryCategoryClient client = mock(InventoryCategoryClient.class);
    private final FeignIngredientReferenceValidator validator = new FeignIngredientReferenceValidator(client);

    @Test
    void allowsWhenIngredientResolvesWithANonNullCategory() {
        UUID id = UUID.randomUUID();
        when(client.getIngredientCategories(List.of(id)))
                .thenReturn(List.of(new IngredientCategoryResponse(id, UUID.randomUUID(), "Produce", "Produce")));

        assertThatCode(() -> validator.requireIngredientInTenant(id)).doesNotThrowAnyException();
    }

    @Test
    void rejectsWhenIngredientResolvesButCarriesNoCategory() {
        // The internal endpoint returns an entry for every id; an unknown/foreign id comes back with
        // a null categoryId (real in-tenant ingredients always have a NOT NULL category since 08.2-01).
        UUID id = UUID.randomUUID();
        when(client.getIngredientCategories(List.of(id)))
                .thenReturn(List.of(new IngredientCategoryResponse(id, null, "Uncategorized", "Uncategorized")));

        assertThatThrownBy(() -> validator.requireIngredientInTenant(id))
                .isInstanceOf(IngredientNotInTenantException.class);
    }

    @Test
    void rejectsWhenEndpointReturnsNoMatchingEntry() {
        UUID id = UUID.randomUUID();
        when(client.getIngredientCategories(List.of(id))).thenReturn(List.of());

        assertThatThrownBy(() -> validator.requireIngredientInTenant(id))
                .isInstanceOf(IngredientNotInTenantException.class);
    }

    @Test
    void degradesOpenWhenInventoryServiceIsUnreachable() {
        UUID id = UUID.randomUUID();
        when(client.getIngredientCategories(List.of(id)))
                .thenThrow(new RuntimeException("connection refused"));

        // Transport failure must not couple vendor-catalog availability to inventory-service uptime.
        assertThatCode(() -> validator.requireIngredientInTenant(id)).doesNotThrowAnyException();
    }

    @Test
    void allowsNullIdWithoutCallingInventoryService() {
        assertThatCode(() -> validator.requireIngredientInTenant(null)).doesNotThrowAnyException();
    }
}
