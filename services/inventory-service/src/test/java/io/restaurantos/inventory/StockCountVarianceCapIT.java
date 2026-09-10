package io.restaurantos.inventory;

import io.restaurantos.shared.testsupport.TenantContextBindingTestFilter;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.inventory.domain.model.Ingredient;
import io.restaurantos.inventory.domain.model.ItemCategory;
import io.restaurantos.inventory.dto.StockCountDtos.CountLineRequest;
import io.restaurantos.inventory.dto.StockCountDtos.CreateStockCountRequest;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.IngredientBranchStockRepository;
import io.restaurantos.inventory.repository.ItemCategoryRepository;
import io.restaurantos.inventory.repository.StockCountLineRepository;
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
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Stock-count variance caps: the enforcement that finally makes
 * {@code item_categories.variance_cap_pct} mean something.
 *
 * <p>The column has existed since V5 and been settable from the category form since 08.2, but
 * nothing read it. Every variance posted at any magnitude — a mis-keyed count turning 4100 into 41
 * wrote off the difference silently, leaving a ledger entry indistinguishable from a correct one.
 *
 * <p>The rule is deliberately an ATTRIBUTION gate, not a refusal: a count must always be able to
 * record what is physically on the shelf, so an over-cap line posts fine once someone says why, and
 * the reason is stored against it. What is no longer possible is a large write-off that nobody
 * chose and nobody can later explain.
 */
class StockCountVarianceCapIT extends InventoryTestBase {

    @Autowired WebApplicationContext webApplicationContext;
    @Autowired TenantContext tenantContext;
    @Autowired ObjectMapper objectMapper;
    @Autowired IngredientRepository ingredientRepository;
    @Autowired ItemCategoryRepository itemCategoryRepository;
    @Autowired IngredientBranchStockRepository stockRepository;
    @Autowired StockCountLineRepository stockCountLineRepository;

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

    private UUID category(String name, UUID parentId, short level, BigDecimal capPct) {
        ItemCategory category = new ItemCategory();
        category.setTenantId(tenantId);
        category.setName(name);
        category.setParentId(parentId);
        category.setLevel(level);
        category.setVarianceCapPct(capPct);
        return itemCategoryRepository.save(category).getId();
    }

    /** An ingredient in {@code categoryId} with {@code onHand} already on the shelf at this branch. */
    private UUID ingredientWithStock(String name, UUID categoryId, BigDecimal onHand) {
        Ingredient ingredient = new Ingredient();
        ingredient.setTenantId(tenantId);
        ingredient.setName(name);
        ingredient.setSku("SKU-" + name.replace(' ', '-'));
        ingredient.setBaseUomCode("G");
        ingredient.setCategoryId(categoryId);
        ingredient.setReorderPoint(BigDecimal.ZERO);
        ingredient.setActive(true);
        UUID ingredientId = ingredientRepository.save(ingredient).getId();

        var stock = InventoryFixtures.seedStock(stockRepository, tenantId, branchId, ingredientId, onHand, 100L);
        assertThat(stock.getQtyOnHand()).isEqualByComparingTo(onHand);
        return ingredientId;
    }

    private MvcResult postCount(List<CountLineRequest> lines, int expectedStatus) throws Exception {
        return mockMvc.perform(post("/api/v1/inventory/counts")
                        .with(asManager())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new CreateStockCountRequest(branchId, lines))))
                .andExpect(status().is(expectedStatus))
                .andReturn();
    }

    // ---- enforcement ----

    @Test
    void aVarianceWithinTheCapPostsWithNoReasonNeeded() throws Exception {
        UUID categoryId = category("Dry Goods", null, (short) 1, BigDecimal.valueOf(10));
        UUID ingredientId = ingredientWithStock("Flour", categoryId, BigDecimal.valueOf(100));

        // 95 vs 100 is a 5% shortfall, inside the 10% cap.
        postCount(List.of(new CountLineRequest(ingredientId, BigDecimal.valueOf(95), null)), 200);

        var line = stockCountLineRepository.findAll().stream()
                .filter(l -> ingredientId.equals(l.getIngredientId())).findFirst().orElseThrow();
        assertThat(line.getVariancePct()).isEqualByComparingTo(BigDecimal.valueOf(-5));
        assertThat(line.getCapPct()).isEqualByComparingTo(BigDecimal.valueOf(10));
        // No reason was needed, so none is invented — a stored reason always means a real breach.
        assertThat(line.getOverrideReason()).isNull();
    }

    @Test
    void anOverCapVarianceIsRefusedWithoutAReason() throws Exception {
        UUID categoryId = category("Proteins", null, (short) 1, BigDecimal.valueOf(5));
        UUID ingredientId = ingredientWithStock("Chicken", categoryId, BigDecimal.valueOf(4100));

        // The exact fat-finger this exists to catch: 4100 keyed as 41, a 99% write-off.
        MvcResult result = postCount(
                List.of(new CountLineRequest(ingredientId, BigDecimal.valueOf(41), null)), 422);

        JsonNode error = objectMapper.readTree(result.getResponse().getContentAsString()).path("error");
        assertThat(error.path("code").asText()).isEqualTo("COUNT_VARIANCE_OVER_CAP");
        assertThat(error.path("message").asText()).contains("Chicken").contains("5%");
    }

    @Test
    void aRefusedCountWritesNothingAtAll() throws Exception {
        UUID categoryId = category("Proteins", null, (short) 1, BigDecimal.valueOf(5));
        UUID ingredientId = ingredientWithStock("Chicken", categoryId, BigDecimal.valueOf(4100));

        postCount(List.of(new CountLineRequest(ingredientId, BigDecimal.valueOf(41), null)), 422);

        // The whole transaction rolls back: on-hand is untouched and no count line survives. A
        // count posts whole or not at all — never half-applied with the awkward lines dropped.
        var stock = stockRepository.findByTenantIdAndBranchIdOrderByIngredientIdAsc(tenantId, branchId)
                .stream().filter(s -> ingredientId.equals(s.getIngredientId())).findFirst().orElseThrow();
        assertThat(stock.getQtyOnHand()).isEqualByComparingTo(BigDecimal.valueOf(4100));
        assertThat(stockCountLineRepository.findAll()).noneMatch(l -> ingredientId.equals(l.getIngredientId()));
    }

    @Test
    void theSameCountPostsOnceAReasonIsGiven() throws Exception {
        UUID categoryId = category("Proteins", null, (short) 1, BigDecimal.valueOf(5));
        UUID ingredientId = ingredientWithStock("Chicken", categoryId, BigDecimal.valueOf(4100));

        postCount(List.of(new CountLineRequest(
                ingredientId, BigDecimal.valueOf(41), "Freezer failure — spoilage written off")), 200);

        var line = stockCountLineRepository.findAll().stream()
                .filter(l -> ingredientId.equals(l.getIngredientId())).findFirst().orElseThrow();
        // Stored against the line forever: this is what an auditor reads months later when they
        // ask why 4 kg of chicken vanished on a Tuesday.
        assertThat(line.getOverrideReason()).isEqualTo("Freezer failure — spoilage written off");
        assertThat(line.getCapPct()).isEqualByComparingTo(BigDecimal.valueOf(5));
        assertThat(line.getVariancePct().abs()).isGreaterThan(BigDecimal.valueOf(90));
    }

    @Test
    void everyOverCapLineIsReportedAtOnceRatherThanOneAtATime() throws Exception {
        UUID categoryId = category("Proteins", null, (short) 1, BigDecimal.valueOf(5));
        UUID chicken = ingredientWithStock("Chicken", categoryId, BigDecimal.valueOf(1000));
        UUID beef = ingredientWithStock("Beef", categoryId, BigDecimal.valueOf(1000));

        MvcResult result = postCount(List.of(
                new CountLineRequest(chicken, BigDecimal.valueOf(10), null),
                new CountLineRequest(beef, BigDecimal.valueOf(20), null)), 422);

        // Fixing them one rejected post at a time would be maddening on a real count sheet.
        assertThat(objectMapper.readTree(result.getResponse().getContentAsString())
                .path("error").path("message").asText()).contains("2 items");
    }

    // ---- resolution ----

    @Test
    void theCapIsInheritedFromAnAncestorCategory() throws Exception {
        UUID proteins = category("Proteins", null, (short) 1, BigDecimal.valueOf(5));
        UUID poultry = category("Poultry", proteins, (short) 2, null);
        UUID ingredientId = ingredientWithStock("Chicken", poultry, BigDecimal.valueOf(1000));

        // Poultry sets no cap of its own, so Proteins' 5% governs — the entire point of hanging
        // the cap on a tree instead of setting a threshold on every leaf.
        postCount(List.of(new CountLineRequest(ingredientId, BigDecimal.valueOf(500), null)), 422);
    }

    @Test
    void aChildCapOverridesItsAncestorsMostSpecificWins() throws Exception {
        UUID proteins = category("Proteins", null, (short) 1, BigDecimal.valueOf(5));
        UUID poultry = category("Poultry", proteins, (short) 2, BigDecimal.valueOf(60));
        UUID ingredientId = ingredientWithStock("Chicken", poultry, BigDecimal.valueOf(1000));

        // 50% off would breach Proteins' 5%, but Poultry's own 60% is the more specific rule.
        postCount(List.of(new CountLineRequest(ingredientId, BigDecimal.valueOf(500), null)), 200);
    }

    @Test
    void anUncappedCategoryLetsAnyVariancePost() throws Exception {
        UUID categoryId = category("Sundries", null, (short) 1, null);
        UUID ingredientId = ingredientWithStock("Napkins", categoryId, BigDecimal.valueOf(1000));

        postCount(List.of(new CountLineRequest(ingredientId, BigDecimal.ZERO, null)), 200);

        var line = stockCountLineRepository.findAll().stream()
                .filter(l -> ingredientId.equals(l.getIngredientId())).findFirst().orElseThrow();
        assertThat(line.getCapPct()).isNull();
    }

    @Test
    void aFirstCountAgainstZeroOnHandIsNotTreatedAsAnInfiniteVariance() throws Exception {
        UUID categoryId = category("Proteins", null, (short) 1, BigDecimal.valueOf(5));
        UUID ingredientId = ingredientWithStock("Chicken", categoryId, BigDecimal.ZERO);

        // A percentage needs a base. Demanding an override on every first count would train people
        // to type meaningless reasons, which destroys the control the cap exists to provide.
        postCount(List.of(new CountLineRequest(ingredientId, BigDecimal.valueOf(500), null)), 200);

        var line = stockCountLineRepository.findAll().stream()
                .filter(l -> ingredientId.equals(l.getIngredientId())).findFirst().orElseThrow();
        assertThat(line.getVariancePct()).isNull();
        assertThat(line.getOverrideReason()).isNull();
    }

    // ---- the read model the count sheet warns from ----

    @Test
    void stockLevelsExposeTheResolvedCapAndCategorySoTheSheetCanWarnFirst() throws Exception {
        UUID proteins = category("Proteins", null, (short) 1, BigDecimal.valueOf(5));
        UUID poultry = category("Poultry", proteins, (short) 2, null);
        ingredientWithStock("Chicken", poultry, BigDecimal.valueOf(1000));

        MvcResult result = mockMvc.perform(get("/api/v1/inventory/stock")
                        .param("branchId", branchId.toString())
                        .with(asManager()))
                .andExpect(status().isOk())
                .andReturn();

        JsonNode row = objectMapper.readTree(result.getResponse().getContentAsString())
                .path("data").path("items").get(0);
        // Inherited from Proteins, since Poultry sets no cap of its own — the same resolution the
        // count sheet warns from and StockCountService enforces on.
        assertThat(row.path("varianceCapPct").decimalValue()).isEqualByComparingTo(BigDecimal.valueOf(5));
        // categoryId/categoryName were hardcoded null in StockLevelService until now, which is why
        // the Stock page showed "—" for every category and its category filter matched nothing.
        assertThat(row.path("categoryId").asText()).isEqualTo(poultry.toString());
        assertThat(row.path("categoryName").asText()).isEqualTo("Poultry");
    }
}
