package io.restaurantos.inventory;

import io.restaurantos.shared.testsupport.TenantContextBindingTestFilter;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.inventory.dto.InventoryDtos.CreateIngredientRequest;
import io.restaurantos.inventory.dto.InventoryDtos.CreateUomRequest;
import io.restaurantos.inventory.dto.ItemCategoryDtos.CreateItemCategoryRequest;
import io.restaurantos.inventory.dto.RecipeDtos.CreateRecipeVersionRequest;
import io.restaurantos.inventory.dto.RecipeDtos.RecipeLineRequest;
import io.restaurantos.inventory.dto.StorageLocationDtos.CreateStorageLocationRequest;
import io.restaurantos.inventory.dto.StorageLocationDtos.UpdateStorageLocationRequest;
import io.restaurantos.inventory.domain.model.MenuItemCatalog;
import io.restaurantos.inventory.repository.MenuItemCatalogRepository;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.feature.FeatureFlagService;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
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
 * The master-data surfaces that had no screen, and therefore no validation worth the name, until
 * the Setup screen and V10 arrived:
 *
 * <ul>
 *   <li><strong>House units</strong> — {@code POST /api/v1/inventory/uom} existed since 08.2-01
 *       with no caller at all, so it took whatever it was handed. A duplicate code surfaced as a
 *       {@code uq_uom_tenant_code_ci} violation (a 500), and an unknown or cross-dimension base
 *       unit saved happily, producing a unit {@code UomConverter} can never convert.</li>
 *   <li><strong>Storage locations</strong> — free text on {@code ingredients} until V10, so three
 *       spellings of one walk-in were three walk-ins to anything trying to group by it.</li>
 *   <li><strong>Prep items</strong> — {@code itemType} and {@code producedByRecipeId} were both
 *       accepted unvalidated, making {@code PREPARED}/{@code BOTH} a dead option on the form.</li>
 *   <li><strong>Recipe lines</strong> — {@code ingredientId} and {@code uomCode} were taken on
 *       trust, so a recipe could name an archived item or call for millilitres of a weight.</li>
 * </ul>
 *
 * <p>Mirrors {@link IngredientMasterDataIT}'s harness: a fresh random tenant per test, OPA
 * allowed, feature flag on, MockMvc over the real HTTP dispatch.
 */
class InventorySetupMasterDataIT extends InventoryTestBase {

    @Autowired WebApplicationContext webApplicationContext;
    @Autowired TenantContext tenantContext;
    @Autowired ObjectMapper objectMapper;
    @Autowired MenuItemCatalogRepository menuItemCatalogRepository;

    @MockitoBean FeatureFlagService featureFlagService;

    MockMvc mockMvc;
    UUID tenantId;
    UUID branchId;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .apply(SecurityMockMvcConfigurers.springSecurity())
                // Binds TenantContext per REQUEST from the authenticated principal, the way
                // JwtAuthenticationFilter does in production. Without it every perform() after the
                // first runs with no tenant: the production filter clears on the way out, and it is
                // right to. See TenantContextBindingTestFilter.
                .addFilter(TenantContextBindingTestFilter.from(webApplicationContext), "/*")
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

    private JsonNode dataOf(MvcResult result) throws Exception {
        return objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
    }

    private UUID createCategory(String name) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/inventory/categories")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateItemCategoryRequest(
                                null, name, null, null, null, null, null, null, null))))
                .andExpect(status().isOk())
                .andReturn();
        return UUID.fromString(dataOf(result).path("id").asText());
    }

    private UUID createStorageLocation(String name) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/inventory/storage-locations")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new CreateStorageLocationRequest(name, null, null))))
                .andExpect(status().isOk())
                .andReturn();
        return UUID.fromString(dataOf(result).path("id").asText());
    }

    private CreateIngredientRequest ingredientRequest(String name, String sku, UUID categoryId,
                                                       String itemType, UUID producedByRecipeId,
                                                       UUID storageLocationId) {
        return new CreateIngredientRequest(
                name, sku, "KG", categoryId,
                null, null, itemType, producedByRecipeId, "WEIGHT", null,
                null, storageLocationId, null, false,
                BigDecimal.valueOf(5), null, null, null);
    }

    private UUID createIngredient(CreateIngredientRequest request) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/inventory/ingredients")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andReturn();
        return UUID.fromString(dataOf(result).path("id").asText());
    }

    private UUID createMenuItem(String name) {
        MenuItemCatalog item = new MenuItemCatalog();
        item.setTenantId(tenantId);
        item.setMenuItemId(UUID.randomUUID());
        item.setName(name);
        item.setActive(true);
        menuItemCatalogRepository.save(item);
        return item.getMenuItemId();
    }

    // ---- house units ----

    @Test
    void aHouseUnitIsCreatedAgainstTheTenantsOwnBaseUnit() throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/inventory/uom")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateUomRequest(
                                "CASE", "Case", "COUNT", "EACH", BigDecimal.valueOf(24)))))
                .andExpect(status().isOk())
                .andReturn();

        JsonNode created = dataOf(result);
        assertThat(created.path("code").asText()).isEqualTo("CASE");
        assertThat(created.path("measureType").asText()).isEqualTo("COUNT");
        assertThat(created.path("baseUnitCode").asText()).isEqualTo("EACH");
    }

    @Test
    void aDuplicateUnitCodeIsA422NamingTheExistingUnitNotAConstraintViolation() throws Exception {
        // "KG" is part of the standard set every tenant is provisioned with lazily. Before this
        // check existed the insert reached uq_uom_tenant_code_ci and came back as a 500 with a
        // stack trace, which tells a manager nothing.
        mockMvc.perform(post("/api/v1/inventory/uom")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateUomRequest(
                                "kg", "Kilos", "WEIGHT", "G", BigDecimal.valueOf(1000)))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("UOM_DUPLICATE_CODE"))
                .andExpect(jsonPath("$.error.message").value(
                        "The unit code \"KG\" is already used by \"Kilogram\"."));
    }

    @Test
    void aBaseUnitFromAnotherDimensionIsRefused() throws Exception {
        // A COUNT unit measured in grams would produce a factor nothing can apply — UomConverter
        // multiplies into the family's base, and this unit has no family.
        mockMvc.perform(post("/api/v1/inventory/uom")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateUomRequest(
                                "TRAY", "Tray", "COUNT", "G", BigDecimal.valueOf(500)))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("UOM_DIMENSION_MISMATCH"));
    }

    @Test
    void anUnknownBaseUnitIsRefused() throws Exception {
        mockMvc.perform(post("/api/v1/inventory/uom")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateUomRequest(
                                "BUNCH", "Bunch", "COUNT", "SPRIG", BigDecimal.valueOf(10)))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("UOM_NOT_FOUND"));
    }

    @Test
    void aUnitDeclaringItselfAFamilyBaseMustHaveAFactorOfOne() throws Exception {
        // No base unit means "this IS the base of its family" — the invariant
        // RecipeCostPreviewService.dimensionMatches reads. A base with a factor of 12 is simply
        // internally inconsistent, whatever it was meant to say.
        mockMvc.perform(post("/api/v1/inventory/uom")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateUomRequest(
                                "SCOOP", "Scoop", "COUNT", null, BigDecimal.valueOf(12)))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("UOM_CONVERSION_INVALID"));
    }

    // ---- storage locations ----

    @Test
    void aStorageLocationRoundTripsAndItsNameIsMirroredOntoTheIngredient() throws Exception {
        UUID categoryId = createCategory("Proteins");
        UUID locationId = createStorageLocation("Walk-in Cooler");
        UUID ingredientId = createIngredient(
                ingredientRequest("Chicken", "ING-CHK", categoryId, "PURCHASED", null, locationId));

        MvcResult result = mockMvc.perform(get("/api/v1/inventory/ingredients/" + ingredientId)
                        .with(asManager()))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode fetched = dataOf(result);

        assertThat(fetched.path("storageLocationId").asText()).isEqualTo(locationId.toString());
        // The retained free-text column is DERIVED from the location's name (V10) rather than
        // echoed from the request, so the two representations cannot drift apart.
        assertThat(fetched.path("storageLocation").asText()).isEqualTo("Walk-in Cooler");
    }

    @Test
    void aDuplicateLocationNameIsRefusedCaseInsensitively() throws Exception {
        createStorageLocation("Freezer");

        mockMvc.perform(post("/api/v1/inventory/storage-locations")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new CreateStorageLocationRequest("  freezer  ", null, null))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("STORAGE_LOCATION_DUPLICATE"));
    }

    @Test
    void archivingAnOccupiedLocationIsRefusedWithItsLiveItemCount() throws Exception {
        UUID categoryId = createCategory("Proteins");
        UUID locationId = createStorageLocation("Walk-in Cooler");
        createIngredient(ingredientRequest("Chicken", "ING-CHK", categoryId, "PURCHASED", null, locationId));

        // 409, not 422: this is a state conflict, and it is the same answer CategoryInUseException
        // already gives for the identical situation on categories. RESTRICT on the FK would refuse
        // a delete anyway; this turns that into a sentence naming what is in the way.
        mockMvc.perform(post("/api/v1/inventory/storage-locations/" + locationId + "/archive")
                        .with(asManager()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("STORAGE_LOCATION_IN_USE"))
                .andExpect(jsonPath("$.error.message").value(
                        "Can't archive \"Walk-in Cooler\" — 1 item is still stored there. Move them first."));
    }

    @Test
    void anEmptyLocationArchivesAndThenStopsBeingAssignable() throws Exception {
        UUID categoryId = createCategory("Proteins");
        UUID locationId = createStorageLocation("Old Cupboard");

        mockMvc.perform(post("/api/v1/inventory/storage-locations/" + locationId + "/archive")
                        .with(asManager()))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/v1/inventory/ingredients")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(ingredientRequest(
                                "Rice", "ING-RICE", categoryId, "PURCHASED", null, locationId))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("STORAGE_LOCATION_ARCHIVED"));
    }

    @Test
    void renamingALocationIsReflectedOnItsIngredientsNextRead() throws Exception {
        UUID categoryId = createCategory("Proteins");
        UUID locationId = createStorageLocation("Walkin");
        UUID ingredientId = createIngredient(
                ingredientRequest("Chicken", "ING-CHK", categoryId, "PURCHASED", null, locationId));

        mockMvc.perform(put("/api/v1/inventory/storage-locations/" + locationId)
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new UpdateStorageLocationRequest("Walk-in Cooler", null, null))))
                .andExpect(status().isOk());

        // The id is the reference, so a rename needs no ingredient rewrite — which is exactly the
        // property free text did not have. (The cached text column catches up on the item's next
        // save; the id already reads correctly.)
        MvcResult result = mockMvc.perform(get("/api/v1/inventory/ingredients/" + ingredientId)
                        .with(asManager()))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(dataOf(result).path("storageLocationId").asText()).isEqualTo(locationId.toString());
    }

    @Test
    void aStorageLocationFromAnotherTenantIsA404() throws Exception {
        UUID categoryId = createCategory("Proteins");
        UUID foreignLocationId = UUID.randomUUID();

        mockMvc.perform(post("/api/v1/inventory/ingredients")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(ingredientRequest(
                                "Rice", "ING-RICE", categoryId, "PURCHASED", null, foreignLocationId))))
                .andExpect(status().isNotFound());
    }

    // ---- prep items ----

    @Test
    void aPurchasedItemNamingARecipeIsRefused() throws Exception {
        UUID categoryId = createCategory("Proteins");
        UUID menuItemId = createMenuItem("Zinger Burger");
        UUID ingredientId = createIngredient(
                ingredientRequest("Chicken", "ING-CHK", categoryId, "PURCHASED", null, null));
        UUID recipeId = createRecipe(menuItemId, ingredientId);

        mockMvc.perform(post("/api/v1/inventory/ingredients")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(ingredientRequest(
                                "Sauce", "ING-SAUCE", categoryId, "PURCHASED", recipeId, null))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("ITEM_TYPE_RECIPE_NOT_ALLOWED"));
    }

    @Test
    void aPreparedItemCanNameARealRecipeAndReadsItBack() throws Exception {
        UUID categoryId = createCategory("Proteins");
        UUID menuItemId = createMenuItem("Zinger Burger");
        UUID chickenId = createIngredient(
                ingredientRequest("Chicken", "ING-CHK", categoryId, "PURCHASED", null, null));
        UUID recipeId = createRecipe(menuItemId, chickenId);

        UUID sauceId = createIngredient(
                ingredientRequest("House Sauce", "ING-SAUCE", categoryId, "PREPARED", recipeId, null));

        MvcResult result = mockMvc.perform(get("/api/v1/inventory/ingredients/" + sauceId)
                        .with(asManager()))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(dataOf(result).path("producedByRecipeId").asText()).isEqualTo(recipeId.toString());
        assertThat(dataOf(result).path("itemType").asText()).isEqualTo("PREPARED");
    }

    @Test
    void aPreparedItemIsNotForcedToNameARecipeYet() throws Exception {
        UUID categoryId = createCategory("Proteins");

        // The recipe references the item it produces, so the item HAS to be creatable first.
        // Requiring the link up front would make the only correct authoring order impossible.
        UUID sauceId = createIngredient(
                ingredientRequest("House Sauce", "ING-SAUCE", categoryId, "PREPARED", null, null));

        MvcResult result = mockMvc.perform(get("/api/v1/inventory/ingredients/" + sauceId)
                        .with(asManager()))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(dataOf(result).path("producedByRecipeId").isNull()).isTrue();
    }

    @Test
    void aRecipeFromAnotherTenantCannotBeNamed() throws Exception {
        UUID categoryId = createCategory("Proteins");

        mockMvc.perform(post("/api/v1/inventory/ingredients")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(ingredientRequest(
                                "House Sauce", "ING-SAUCE", categoryId, "PREPARED", UUID.randomUUID(), null))))
                .andExpect(status().isNotFound());
    }

    @Test
    void anUnknownItemTypeIsRefused() throws Exception {
        UUID categoryId = createCategory("Proteins");

        mockMvc.perform(post("/api/v1/inventory/ingredients")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(ingredientRequest(
                                "Rice", "ING-RICE", categoryId, "RAW", null, null))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("ITEM_TYPE_INVALID"));
    }

    @Test
    void theRecipeOptionsEndpointLabelsEachRecipeByItsMenuItem() throws Exception {
        UUID categoryId = createCategory("Proteins");
        UUID menuItemId = createMenuItem("Zinger Burger");
        UUID chickenId = createIngredient(
                ingredientRequest("Chicken", "ING-CHK", categoryId, "PURCHASED", null, null));
        createRecipe(menuItemId, chickenId);

        MvcResult result = mockMvc.perform(get("/api/v1/inventory/recipes/options").with(asManager()))
                .andExpect(status().isOk())
                .andReturn();

        JsonNode options = dataOf(result);
        assertThat(options).hasSize(1);
        assertThat(options.get(0).path("menuItemName").asText()).isEqualTo("Zinger Burger");
        assertThat(options.get(0).path("version").asInt()).isEqualTo(1);
    }

    // ---- recipe lines ----

    private UUID createRecipe(UUID menuItemId, UUID ingredientId) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/inventory/recipes")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateRecipeVersionRequest(
                                menuItemId, BigDecimal.ONE, null, null,
                                List.of(new RecipeLineRequest(
                                        ingredientId, BigDecimal.valueOf(0.2), "KG", null))))))
                .andExpect(status().isOk())
                .andReturn();
        return UUID.fromString(dataOf(result).path("id").asText());
    }

    @Test
    void aRecipeLineCannotCallForAUnitFromAnotherDimension() throws Exception {
        UUID categoryId = createCategory("Proteins");
        UUID menuItemId = createMenuItem("Zinger Burger");
        UUID chickenId = createIngredient(
                ingredientRequest("Chicken", "ING-CHK", categoryId, "PURCHASED", null, null));

        // Chicken is stocked by weight. Nothing in the system knows its density, so 200 ML of it
        // is not a quantity — it is a line the cost preview will silently exclude and depletion
        // will silently skip, which is exactly how this used to fail.
        mockMvc.perform(post("/api/v1/inventory/recipes")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateRecipeVersionRequest(
                                menuItemId, BigDecimal.ONE, null, null,
                                List.of(new RecipeLineRequest(
                                        chickenId, BigDecimal.valueOf(200), "ML", null))))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("UOM_DIMENSION_MISMATCH"));
    }

    @Test
    void aRecipeLineCannotNameAnIngredientFromAnotherTenant() throws Exception {
        UUID menuItemId = createMenuItem("Zinger Burger");

        mockMvc.perform(post("/api/v1/inventory/recipes")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateRecipeVersionRequest(
                                menuItemId, BigDecimal.ONE, null, null,
                                List.of(new RecipeLineRequest(
                                        UUID.randomUUID(), BigDecimal.ONE, "KG", null))))))
                .andExpect(status().isNotFound());
    }

    @Test
    void aRecipeLineCannotUseAnArchivedIngredient() throws Exception {
        UUID categoryId = createCategory("Proteins");
        UUID menuItemId = createMenuItem("Zinger Burger");
        UUID chickenId = createIngredient(
                ingredientRequest("Chicken", "ING-CHK", categoryId, "PURCHASED", null, null));

        mockMvc.perform(post("/api/v1/inventory/ingredients/" + chickenId + "/archive").with(asManager()))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/v1/inventory/recipes")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateRecipeVersionRequest(
                                menuItemId, BigDecimal.ONE, null, null,
                                List.of(new RecipeLineRequest(
                                        chickenId, BigDecimal.ONE, "KG", null))))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("INGREDIENT_CATEGORY_INVALID"));
    }

    @Test
    void aRecipeLinePersistsTheResolvedUnitsOwnCasing() throws Exception {
        UUID categoryId = createCategory("Proteins");
        UUID menuItemId = createMenuItem("Zinger Burger");
        UUID chickenId = createIngredient(
                ingredientRequest("Chicken", "ING-CHK", categoryId, "PURCHASED", null, null));

        MvcResult result = mockMvc.perform(post("/api/v1/inventory/recipes")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateRecipeVersionRequest(
                                menuItemId, BigDecimal.ONE, null, null,
                                List.of(new RecipeLineRequest(
                                        chickenId, BigDecimal.valueOf(0.2), "kg", null))))))
                .andExpect(status().isOk())
                .andReturn();

        // Sent as "kg", stored as "KG" — the tenant's own row. UomConverter and
        // RecipeCostPreviewService.dimensionMatches compare codes as stored, so persisting the
        // request's casing is how a line silently stops costing.
        assertThat(dataOf(result).path("lines").get(0).path("uomCode").asText()).isEqualTo("KG");
    }
}
