package io.restaurantos.inventory;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.inventory.domain.model.MenuItemCatalog;
import io.restaurantos.inventory.dto.InventoryDtos.CreateIngredientRequest;
import io.restaurantos.inventory.dto.InventoryDtos.IngredientCategoryLookupDto;
import io.restaurantos.inventory.dto.InventoryDtos.IngredientConversionDto;
import io.restaurantos.inventory.dto.InventoryDtos.RecordOpeningBalanceRequest;
import io.restaurantos.inventory.dto.InventoryDtos.UpdateIngredientRequest;
import io.restaurantos.inventory.dto.ItemCategoryDtos.CreateItemCategoryRequest;
import io.restaurantos.inventory.dto.RecipeDtos.CreateRecipeVersionRequest;
import io.restaurantos.inventory.dto.RecipeDtos.RecipeLineRequest;
import io.restaurantos.inventory.repository.MenuItemCatalogRepository;
import io.restaurantos.inventory.web.InternalIngredientCategoryController;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.feature.FeatureFlagService;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors;
import org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Full ingredient master-data surface (08.2-09): required primary category, the industry-standard
 * field set (conversions/allergens/par level/storage/shelf life/default yield), the D-06
 * measure-type lock, archive-not-delete (D-04), search/category filters, and the internal
 * batch category-resolution seam. Mirrors {@link IngredientAdminIT}'s harness.
 */
class IngredientMasterDataIT extends InventoryTestBase {

    @Autowired WebApplicationContext webApplicationContext;
    @Autowired TenantContext tenantContext;
    @Autowired ObjectMapper objectMapper;
    @Autowired MenuItemCatalogRepository menuItemCatalogRepository;
    @Autowired InternalIngredientCategoryController internalIngredientCategoryController;

    @MockitoBean FeatureFlagService featureFlagService;

    MockMvc mockMvc;
    UUID tenantId;
    UUID branchId;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .apply(SecurityMockMvcConfigurers.springSecurity())
                .build();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);
        when(featureFlagService.isEnabled(any(), any())).thenReturn(true);
        when(opaClient.evaluate(eq("inventory"), any())).thenReturn(new OpaDecision(true));
    }

    private RequestPostProcessor asManager() {
        JwtClaims claims = new JwtClaims(UUID.randomUUID(), tenantId, branchId,
                List.of("INVENTORY_MANAGER"),
                List.of("inventory.item.view", "inventory.item.manage"), Map.of(), null);
        var authentication = new UsernamePasswordAuthenticationToken(claims, null, List.of());
        return SecurityMockMvcRequestPostProcessors.authentication(authentication);
    }

    // ---- fixtures ----

    private UUID createCategory(String name) throws Exception {
        CreateItemCategoryRequest request = new CreateItemCategoryRequest(
                null, name, null, null, null, null, null, null, null);
        MvcResult result = mockMvc.perform(post("/api/v1/inventory/categories")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode data = objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
        return UUID.fromString(data.path("id").asText());
    }

    private void archiveCategory(UUID categoryId) throws Exception {
        mockMvc.perform(post("/api/v1/inventory/categories/" + categoryId + "/archive").with(asManager()))
                .andExpect(status().isOk());
    }

    private CreateIngredientRequest fullCreateRequest(String name, String sku, UUID categoryId,
                                                       List<IngredientConversionDto> conversions,
                                                       List<String> allergenCodes) {
        return new CreateIngredientRequest(
                name, sku, "KG", categoryId,
                "Short " + name, "Description of " + name, "PURCHASED", null, "WEIGHT", "G",
                BigDecimal.valueOf(95), "Walk-in Cooler, Shelf 3", 14, true,
                BigDecimal.valueOf(5), BigDecimal.valueOf(20), conversions, allergenCodes);
    }

    private JsonNode createIngredient(CreateIngredientRequest request) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/inventory/ingredients")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
    }

    private JsonNode getIngredient(UUID id) throws Exception {
        MvcResult result = mockMvc.perform(get("/api/v1/inventory/ingredients/" + id).with(asManager()))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
    }

    private JsonNode listIngredients(String search, UUID categoryId, String status) throws Exception {
        var requestBuilder = get("/api/v1/inventory/ingredients").with(asManager());
        if (search != null) {
            requestBuilder = requestBuilder.param("search", search);
        }
        if (categoryId != null) {
            requestBuilder = requestBuilder.param("categoryId", categoryId.toString());
        }
        if (status != null) {
            requestBuilder = requestBuilder.param("status", status);
        }
        MvcResult result = mockMvc.perform(requestBuilder)
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
    }

    private void recordOpeningBalance(UUID ingredientId) throws Exception {
        RecordOpeningBalanceRequest request = new RecordOpeningBalanceRequest(
                ingredientId, branchId, BigDecimal.TEN, 500L, null);
        mockMvc.perform(post("/api/v1/inventory/opening-balance")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk());
    }

    // ---- tests ----

    @Test
    void createRequiresAPrimaryCategory() throws Exception {
        CreateIngredientRequest request = fullCreateRequest("No Category", "SKU-NOCAT", null, null, null);

        mockMvc.perform(post("/api/v1/inventory/ingredients")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void createWithAnArchivedOrForeignCategoryIsRejected() throws Exception {
        UUID archivedCategoryId = createCategory("Soon Archived");
        archiveCategory(archivedCategoryId);

        mockMvc.perform(post("/api/v1/inventory/ingredients")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                fullCreateRequest("Archived Cat Item", "SKU-ARCHCAT", archivedCategoryId, null, null))))
                .andExpect(status().is4xxClientError());

        UUID foreignTenantCategoryId = UUID.randomUUID();
        UUID otherTenantId = UUID.randomUUID();
        tenantContext.clear();
        tenantContext.set(otherTenantId, branchId, null, null);
        mockMvc.perform(post("/api/v1/inventory/categories")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateItemCategoryRequest(
                                null, "Other Tenant Category", null, null, null, null, null, null, null))))
                .andExpect(status().isOk());

        // Back to our tenant — foreignTenantCategoryId (a random id never created here) is 404.
        tenantContext.clear();
        tenantContext.set(tenantId, branchId, null, null);
        mockMvc.perform(post("/api/v1/inventory/ingredients")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                fullCreateRequest("Foreign Cat Item", "SKU-FOREIGNCAT", foreignTenantCategoryId, null, null))))
                .andExpect(status().is4xxClientError());
    }

    @Test
    void fullFieldSetRoundTrips() throws Exception {
        UUID categoryId = createCategory("Produce");
        List<IngredientConversionDto> conversions = List.of(
                new IngredientConversionDto("EACH", "KG", BigDecimal.valueOf(0.18), "avg tomato weight"));
        List<String> allergens = List.of("GLUTEN", "DAIRY");

        JsonNode created = createIngredient(fullCreateRequest("Roma Tomato", "SKU-TOMATO", categoryId, conversions, allergens));
        String id = created.path("id").asText();

        JsonNode fetched = getIngredient(UUID.fromString(id));
        assertThat(fetched.path("shortName").asText()).isEqualTo("Short Roma Tomato");
        assertThat(fetched.path("description").asText()).isEqualTo("Description of Roma Tomato");
        assertThat(fetched.path("itemType").asText()).isEqualTo("PURCHASED");
        assertThat(fetched.path("measureType").asText()).isEqualTo("WEIGHT");
        assertThat(fetched.path("recipeUomCode").asText()).isEqualTo("G");
        assertThat(fetched.path("defaultYieldPct").decimalValue()).isEqualByComparingTo(BigDecimal.valueOf(95));
        assertThat(fetched.path("storageLocation").asText()).isEqualTo("Walk-in Cooler, Shelf 3");
        assertThat(fetched.path("shelfLifeDays").asInt()).isEqualTo(14);
        assertThat(fetched.path("perishable").asBoolean()).isTrue();
        assertThat(fetched.path("parLevel").decimalValue()).isEqualByComparingTo(BigDecimal.valueOf(20));
        assertThat(fetched.path("categoryId").asText()).isEqualTo(categoryId.toString());
        assertThat(fetched.path("categoryName").asText()).isEqualTo("Produce");
        assertThat(fetched.path("categoryPath").asText()).isEqualTo("Produce");

        JsonNode conversionsNode = fetched.path("conversions");
        assertThat(conversionsNode).hasSize(1);
        assertThat(conversionsNode.get(0).path("fromUomCode").asText()).isEqualTo("EACH");
        assertThat(conversionsNode.get(0).path("toUomCode").asText()).isEqualTo("KG");
        assertThat(conversionsNode.get(0).path("factor").decimalValue()).isEqualByComparingTo(BigDecimal.valueOf(0.18));

        JsonNode allergensNode = fetched.path("allergenCodes");
        List<String> allergenValues = new ArrayList<>();
        allergensNode.forEach(n -> allergenValues.add(n.asText()));
        assertThat(allergenValues).containsExactlyInAnyOrder("GLUTEN", "DAIRY");
    }

    @Test
    void updateReplacesConversionAndAllergenSetsWholesale() throws Exception {
        UUID categoryId = createCategory("Dairy");
        List<IngredientConversionDto> initialConversions = List.of(
                new IngredientConversionDto("EACH", "KG", BigDecimal.valueOf(0.02), "slice weight"),
                new IngredientConversionDto("CUP", "KG", BigDecimal.valueOf(0.24), "shredded"));
        List<String> initialAllergens = List.of("DAIRY", "SOY");

        JsonNode created = createIngredient(
                fullCreateRequest("Cheddar Cheese", "SKU-CHEDDAR", categoryId, initialConversions, initialAllergens));
        UUID id = UUID.fromString(created.path("id").asText());

        List<IngredientConversionDto> reducedConversions = List.of(
                new IngredientConversionDto("EACH", "KG", BigDecimal.valueOf(0.02), "slice weight"));
        List<String> reducedAllergens = List.of("DAIRY");

        UpdateIngredientRequest updateRequest = new UpdateIngredientRequest(
                "Cheddar Cheese", "KG", categoryId,
                "Short Cheddar", "Updated description", "PURCHASED", null, "WEIGHT", "G",
                BigDecimal.valueOf(95), "Walk-in Cooler, Shelf 3", 14, true,
                BigDecimal.valueOf(5), BigDecimal.valueOf(20), reducedConversions, reducedAllergens, true);

        mockMvc.perform(put("/api/v1/inventory/ingredients/" + id)
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(updateRequest)))
                .andExpect(status().isOk());

        JsonNode fetched = getIngredient(id);
        assertThat(fetched.path("conversions")).hasSize(1);
        assertThat(fetched.path("conversions").get(0).path("toUomCode").asText()).isEqualTo("KG");
        List<String> allergenValues = new ArrayList<>();
        fetched.path("allergenCodes").forEach(n -> allergenValues.add(n.asText()));
        assertThat(allergenValues).containsExactly("DAIRY");
    }

    @Test
    void measureTypeIsLockedOnceStockMovementsExist() throws Exception {
        UUID categoryId = createCategory("Grains");
        JsonNode created = createIngredient(fullCreateRequest("Long Rice", "SKU-RICE-LOCK", categoryId, null, null));
        UUID id = UUID.fromString(created.path("id").asText());

        assertThat(created.path("measureTypeLocked").asBoolean()).isFalse();

        recordOpeningBalance(id);

        JsonNode afterMovement = getIngredient(id);
        assertThat(afterMovement.path("measureTypeLocked").asBoolean()).isTrue();

        UpdateIngredientRequest changeMeasureType = new UpdateIngredientRequest(
                "Long Rice", "KG", categoryId,
                "Short Long Rice", "desc", "PURCHASED", null, "COUNT", "EACH",
                BigDecimal.valueOf(95), "Dry Storage", 365, false,
                BigDecimal.valueOf(5), BigDecimal.valueOf(20), null, null, true);

        mockMvc.perform(put("/api/v1/inventory/ingredients/" + id)
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(changeMeasureType)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.message").value(
                        "Can't change the unit type — stock transactions already exist for this ingredient."));
    }

    @Test
    void measureTypeIsEditableBeforeAnyMovement() throws Exception {
        UUID categoryId = createCategory("Grains");
        JsonNode created = createIngredient(fullCreateRequest("Short Rice", "SKU-RICE-EDIT", categoryId, null, null));
        UUID id = UUID.fromString(created.path("id").asText());

        assertThat(created.path("measureTypeLocked").asBoolean()).isFalse();

        UpdateIngredientRequest changeMeasureType = new UpdateIngredientRequest(
                "Short Rice", "KG", categoryId,
                "Short Short Rice", "desc", "PURCHASED", null, "COUNT", "EACH",
                BigDecimal.valueOf(95), "Dry Storage", 365, false,
                BigDecimal.valueOf(5), BigDecimal.valueOf(20), null, null, true);

        mockMvc.perform(put("/api/v1/inventory/ingredients/" + id)
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(changeMeasureType)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.measureType").value("COUNT"));
    }

    @Test
    void archivingDropsFromTheActiveListButKeepsRecipeAndStockReferencesWorking() throws Exception {
        UUID categoryId = createCategory("Proteins");
        JsonNode created = createIngredient(fullCreateRequest("Chicken Breast", "SKU-CHICKEN", categoryId, null, null));
        UUID id = UUID.fromString(created.path("id").asText());

        recordOpeningBalance(id);

        UUID menuItemId = UUID.randomUUID();
        MenuItemCatalog catalogRow = new MenuItemCatalog();
        catalogRow.setTenantId(tenantId);
        catalogRow.setMenuItemId(menuItemId);
        catalogRow.setName("Grilled Chicken Plate");
        catalogRow.setActive(true);
        menuItemCatalogRepository.save(catalogRow);

        CreateRecipeVersionRequest recipeRequest = new CreateRecipeVersionRequest(
                menuItemId, BigDecimal.ONE, null, "Grilled Chicken Plate",
                List.of(new RecipeLineRequest(id, BigDecimal.valueOf(0.2), "KG", BigDecimal.valueOf(100))));
        mockMvc.perform(post("/api/v1/inventory/recipes")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(recipeRequest)))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/v1/inventory/ingredients/" + id + "/archive").with(asManager()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.archivedAt").exists());

        JsonNode defaultList = listIngredients(null, null, null);
        boolean foundInDefault = false;
        for (JsonNode node : defaultList) {
            if (id.toString().equals(node.path("id").asText())) {
                foundInDefault = true;
            }
        }
        assertThat(foundInDefault).as("archived ingredient must not appear in the default ACTIVE list").isFalse();

        JsonNode archivedList = listIngredients(null, null, "ARCHIVED");
        boolean foundInArchived = false;
        for (JsonNode node : archivedList) {
            if (id.toString().equals(node.path("id").asText())) {
                foundInArchived = true;
            }
        }
        assertThat(foundInArchived).as("archived ingredient must appear in the ARCHIVED filter").isTrue();

        JsonNode stillResolves = getIngredient(id);
        assertThat(stillResolves.path("archivedAt").isNull()).isFalse();

        MvcResult effectiveResult = mockMvc.perform(get("/api/v1/inventory/recipes/" + menuItemId + "/effective")
                        .param("at", Instant.now().toString())
                        .with(asManager()))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode effective = objectMapper.readTree(effectiveResult.getResponse().getContentAsString()).path("data");
        assertThat(effective.path("lines")).hasSize(1);
        assertThat(effective.path("lines").get(0).path("ingredientId").asText()).isEqualTo(id.toString());
    }

    @Test
    void restoreReactivates() throws Exception {
        UUID categoryId = createCategory("Beverages");
        JsonNode created = createIngredient(fullCreateRequest("Orange Juice", "SKU-OJ", categoryId, null, null));
        UUID id = UUID.fromString(created.path("id").asText());

        mockMvc.perform(post("/api/v1/inventory/ingredients/" + id + "/archive").with(asManager()))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/v1/inventory/ingredients/" + id + "/restore").with(asManager()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.active").value(true));

        JsonNode defaultList = listIngredients(null, null, null);
        boolean found = false;
        for (JsonNode node : defaultList) {
            if (id.toString().equals(node.path("id").asText())) {
                found = true;
            }
        }
        assertThat(found).as("restored ingredient should be back in the default ACTIVE list").isTrue();

        JsonNode fetched = getIngredient(id);
        assertThat(fetched.path("archivedAt").isNull()).isTrue();
        assertThat(fetched.path("active").asBoolean()).isTrue();
    }

    @Test
    void searchAndCategoryFiltersNarrowTheList() throws Exception {
        UUID produceId = createCategory("Produce Filter Test");
        UUID dairyId = createCategory("Dairy Filter Test");

        createIngredient(fullCreateRequest("Green Lettuce", "SKU-LETTUCE", produceId, null, null));
        createIngredient(fullCreateRequest("Whole Milk", "SKU-MILK", dairyId, null, null));
        createIngredient(fullCreateRequest("Greek Yogurt", "SKU-YOGURT", dairyId, null, null));

        JsonNode searchResults = listIngredients("green", null, null);
        assertThat(searchResults).hasSize(1);
        assertThat(searchResults.get(0).path("name").asText()).isEqualTo("Green Lettuce");

        JsonNode categoryResults = listIngredients(null, dairyId, null);
        assertThat(categoryResults).hasSize(2);

        JsonNode skuSearch = listIngredients("SKU-MILK", null, null);
        assertThat(skuSearch).hasSize(1);
        assertThat(skuSearch.get(0).path("sku").asText()).isEqualTo("SKU-MILK");
    }

    @Test
    void internalCategoryLookupResolvesABatchOfIngredientIds() throws Exception {
        UUID categoryId = createCategory("Internal Lookup Category");
        JsonNode created = createIngredient(fullCreateRequest("Internal Lookup Item", "SKU-INTLOOKUP", categoryId, null, null));
        UUID ingredientId = UUID.fromString(created.path("id").asText());
        UUID unknownId = UUID.randomUUID();

        ResponseEntity<List<IngredientCategoryLookupDto>> response =
                internalIngredientCategoryController.resolveIngredientCategories(
                        List.of(ingredientId, unknownId), null);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        List<IngredientCategoryLookupDto> body = response.getBody();
        assertThat(body).hasSize(2);

        IngredientCategoryLookupDto known = body.stream()
                .filter(d -> d.ingredientId().equals(ingredientId)).findFirst().orElseThrow();
        assertThat(known.categoryId()).isEqualTo(categoryId);
        assertThat(known.categoryName()).isEqualTo("Internal Lookup Category");

        IngredientCategoryLookupDto unknown = body.stream()
                .filter(d -> d.ingredientId().equals(unknownId)).findFirst().orElseThrow();
        assertThat(unknown.categoryId()).isNull();
        assertThat(unknown.categoryName()).isEqualTo("Uncategorized");
    }

    @Test
    void internalCategoryLookupRejectsAnOversizedBatch() {
        List<UUID> oversizedBatch = new ArrayList<>();
        for (int i = 0; i < 501; i++) {
            oversizedBatch.add(UUID.randomUUID());
        }

        ResponseEntity<List<IngredientCategoryLookupDto>> response =
                internalIngredientCategoryController.resolveIngredientCategories(oversizedBatch, null);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }
}
