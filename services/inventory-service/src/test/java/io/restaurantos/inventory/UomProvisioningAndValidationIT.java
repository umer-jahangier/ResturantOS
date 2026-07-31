package io.restaurantos.inventory;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.inventory.dto.InventoryDtos.CreateIngredientRequest;
import io.restaurantos.inventory.dto.InventoryDtos.IngredientConversionDto;
import io.restaurantos.inventory.dto.ItemCategoryDtos.CreateItemCategoryRequest;
import io.restaurantos.inventory.repository.UnitOfMeasureRepository;
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
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Per-tenant unit-of-measure provisioning and the ingredient-write unit validation it makes
 * possible.
 *
 * <p>Covers the two defects this suite exists for. First, {@code units_of_measure} is tenant-scoped
 * under FORCE RLS and no migration ever seeded it, so a new tenant reached the ingredient form with
 * an empty (but required) "Stock unit" select and no UI able to fill it — every test here starts on
 * a fresh random tenant, so provisioning-from-nothing is the default path rather than a special
 * case. Second, {@code createIngredient} previously assigned {@code baseUomCode} with no lookup at
 * all, so an unknown code, or a stock unit from an entirely different dimension than the declared
 * measure type, saved silently.
 *
 * <p>Mirrors {@link IngredientMasterDataIT}'s harness (fresh tenant per test, OPA allowed,
 * feature flag on, MockMvc over the real HTTP dispatch).
 */
class UomProvisioningAndValidationIT extends InventoryTestBase {

    @Autowired WebApplicationContext webApplicationContext;
    @Autowired TenantContext tenantContext;
    @Autowired ObjectMapper objectMapper;
    @Autowired UnitOfMeasureRepository unitOfMeasureRepository;

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

    private JsonNode listUoms() throws Exception {
        MvcResult result = mockMvc.perform(get("/api/v1/inventory/uom").with(asManager()))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
    }

    private CreateIngredientRequest request(String sku, UUID categoryId, String baseUomCode,
                                             String measureType, String recipeUomCode,
                                             List<IngredientConversionDto> conversions) {
        return new CreateIngredientRequest(
                "Item " + sku, sku, baseUomCode, categoryId,
                null, null, "PURCHASED", null, measureType, recipeUomCode,
                null, null, null, false,
                BigDecimal.valueOf(5), null, conversions, null);
    }

    private static List<String> codesOf(JsonNode uoms) {
        List<String> codes = new ArrayList<>();
        uoms.forEach(u -> codes.add(u.path("code").asText()));
        return codes;
    }

    // ---- provisioning ----

    @Test
    void standardUnitsAreProvisionedOnFirstListForABrandNewTenant() throws Exception {
        // Nothing has ever written a units_of_measure row for this tenant. Scoped by tenant id
        // explicitly: the Testcontainers role owns the schema, so FORCE RLS does not constrain
        // this query the way it does a real deployment's connection.
        assertThat(unitOfMeasureRepository.findByTenantId(tenantId)).isEmpty();

        JsonNode uoms = listUoms();

        List<String> codes = codesOf(uoms);
        assertThat(codes).contains("G", "KG", "ML", "L", "EACH", "DOZEN");
        // All three dimensions are represented, which is what makes the form's measure-type
        // filter usable rather than emptying the select for two of the three choices.
        assertThat(uoms).allSatisfy(u ->
                assertThat(u.path("measureType").asText()).isIn("WEIGHT", "VOLUME", "COUNT"));
        assertThat(uoms.findValuesAsText("measureType")).contains("WEIGHT", "VOLUME", "COUNT");
    }

    @Test
    void provisioningIsIdempotentAcrossRepeatedCalls() throws Exception {
        List<String> first = codesOf(listUoms());
        List<String> second = codesOf(listUoms());

        assertThat(second).isEqualTo(first);
        assertThat(second).doesNotHaveDuplicates();
    }

    @Test
    void aTenantHoldingOneHandCreatedUnitGetsTheRestWithoutADuplicate() throws Exception {
        // Exactly how the live tenants got here: a single lowercase 'g' created ad hoc, which an
        // "is this tenant empty?" guard would have treated as fully provisioned, leaving the
        // tenant stuck on one unit forever.
        InventoryFixtures.seedUom(unitOfMeasureRepository, tenantId,
                "g", "Gram (existing)", "WEIGHT", null, BigDecimal.ONE);

        JsonNode uoms = listUoms();
        List<String> codes = codesOf(uoms);

        // The tenant's own row and its casing survive; no second gram row is introduced.
        assertThat(codes).contains("g").doesNotContain("G");
        assertThat(codes.stream().filter(c -> c.equalsIgnoreCase("g")).count()).isEqualTo(1);
        // ...and the rest of the standard set did arrive.
        assertThat(codes).contains("KG", "ML", "EACH");

        // A newly seeded derived unit points at the tenant's OWN base row, casing included —
        // otherwise RecipeCostPreviewService.dimensionMatches would never pair KG with g.
        JsonNode kg = uoms.findParents("code").stream()
                .filter(u -> "KG".equals(u.path("code").asText()))
                .findFirst()
                .orElseThrow();
        assertThat(kg.path("baseUnitCode").asText()).isEqualTo("g");
        assertThat(kg.path("toBaseFactor").decimalValue()).isEqualByComparingTo(BigDecimal.valueOf(1000));
    }

    // ---- ingredient write validation ----

    @Test
    void unknownStockUnitIsRejected() throws Exception {
        UUID categoryId = createCategory("Grains");

        mockMvc.perform(post("/api/v1/inventory/ingredients")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                request("SKU-UNKNOWN", categoryId, "PARSEC", "WEIGHT", null, null))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("UOM_NOT_FOUND"));
    }

    @Test
    void stockUnitFromAnotherDimensionIsRejected() throws Exception {
        UUID categoryId = createCategory("Grains");

        // The exact pairing the unfiltered form used to allow: measure type COUNT, stock unit grams.
        mockMvc.perform(post("/api/v1/inventory/ingredients")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                request("SKU-MISMATCH", categoryId, "G", "COUNT", null, null))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("UOM_DIMENSION_MISMATCH"));
    }

    @Test
    void recipeUnitFromAnotherDimensionIsRejected() throws Exception {
        UUID categoryId = createCategory("Grains");

        mockMvc.perform(post("/api/v1/inventory/ingredients")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                request("SKU-RECIPE-MISMATCH", categoryId, "KG", "WEIGHT", "ML", null))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("UOM_DIMENSION_MISMATCH"));
    }

    @Test
    void measureTypeIsDerivedFromTheStockUnitWhenOmitted() throws Exception {
        UUID categoryId = createCategory("Grains");

        // Previously a null measure type defaulted blindly to COUNT regardless of the unit beside
        // it — the source of every "Count / grams" row in the wild.
        mockMvc.perform(post("/api/v1/inventory/ingredients")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                request("SKU-DERIVED", categoryId, "KG", null, null, null))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.measureType").value("WEIGHT"));
    }

    @Test
    void unitCodeCasingIsNormalisedToTheResolvedRow() throws Exception {
        UUID categoryId = createCategory("Grains");

        // A request may use any casing; what gets stored is the tenant's own row's code, so
        // downstream dimension matching and UOM conversion always compare like with like.
        mockMvc.perform(post("/api/v1/inventory/ingredients")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                request("SKU-CASING", categoryId, "kg", "weight", "g", null))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.baseUomCode").value("KG"))
                .andExpect(jsonPath("$.data.recipeUomCode").value("G"))
                .andExpect(jsonPath("$.data.measureType").value("WEIGHT"));
    }

    @Test
    void conversionToAnUnknownUnitIsRejected() throws Exception {
        UUID categoryId = createCategory("Produce");

        mockMvc.perform(post("/api/v1/inventory/ingredients")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request(
                                "SKU-CONV-UNKNOWN", categoryId, "G", "WEIGHT", null,
                                List.of(new IngredientConversionDto("CRATE", "G", BigDecimal.TEN, null))))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("UOM_NOT_FOUND"));
    }

    @Test
    void selfReferentialConversionIsRejected() throws Exception {
        UUID categoryId = createCategory("Produce");

        mockMvc.perform(post("/api/v1/inventory/ingredients")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request(
                                "SKU-CONV-SELF", categoryId, "G", "WEIGHT", null,
                                List.of(new IngredientConversionDto("G", "g", BigDecimal.ONE, null))))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("UOM_CONVERSION_INVALID"));
    }

    @Test
    void crossDimensionConversionIsAllowedBecauseThatIsWhatConversionsAreFor() throws Exception {
        UUID categoryId = createCategory("Produce");

        // "1 each = 180 g" is the whole point of per-ingredient conversions: purchase by count,
        // stock by weight. The dimension rule applies to the stock/recipe units, never to these.
        mockMvc.perform(post("/api/v1/inventory/ingredients")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request(
                                "SKU-CONV-CROSS", categoryId, "G", "WEIGHT", null,
                                List.of(new IngredientConversionDto(
                                        "EACH", "G", BigDecimal.valueOf(180), "avg tomato"))))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.conversions[0].fromUomCode").value("EACH"))
                .andExpect(jsonPath("$.data.conversions[0].toUomCode").value("G"));
    }
}
