package io.restaurantos.inventory;

import io.restaurantos.inventory.domain.model.Ingredient;
import io.restaurantos.inventory.domain.model.IngredientBranchStock;
import io.restaurantos.inventory.domain.model.MenuItemCatalog;
import io.restaurantos.inventory.domain.model.UnitOfMeasure;
import io.restaurantos.inventory.dto.RecipeDtos.PreviewRecipeCostRequest;
import io.restaurantos.inventory.dto.RecipeDtos.RecipeCostLineDto;
import io.restaurantos.inventory.dto.RecipeDtos.RecipeCostPreviewDto;
import io.restaurantos.inventory.dto.RecipeDtos.RecipeLineRequest;
import io.restaurantos.inventory.repository.IngredientBranchStockRepository;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.MenuItemCatalogRepository;
import io.restaurantos.inventory.repository.UnitOfMeasureRepository;
import io.restaurantos.inventory.service.RecipeCostPreviewService;
import io.restaurantos.inventory.service.UomConverter;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Plain Mockito unit test — mirrors {@code RecipeVersionResolutionTest}'s precedent (mocked
 * repositories, no Spring context). Proves {@link RecipeCostPreviewService}'s arithmetic,
 * degradation behaviour and zero-division safety in isolation; see {@code RecipeCostPreviewIT}
 * for the HTTP-level, DB-backed, non-persistence, and authorization proofs.
 */
class RecipeCostPreviewTest {

    private final UUID tenantId = UUID.randomUUID();
    private final UUID branchId = UUID.randomUUID();

    private RecipeCostPreviewService serviceWith(List<Ingredient> ingredients, List<UnitOfMeasure> uoms,
                                                   List<IngredientBranchStock> stocks,
                                                   MenuItemCatalog catalog) {
        IngredientRepository ingredientRepository = mock(IngredientRepository.class);
        IngredientBranchStockRepository stockRepository = mock(IngredientBranchStockRepository.class);
        UnitOfMeasureRepository unitOfMeasureRepository = mock(UnitOfMeasureRepository.class);
        MenuItemCatalogRepository menuItemCatalogRepository = mock(MenuItemCatalogRepository.class);
        TenantContext tenantContext = mock(TenantContext.class);

        when(tenantContext.requireTenantId()).thenReturn(tenantId);
        when(ingredientRepository.findAllById(any())).thenReturn(ingredients);
        when(unitOfMeasureRepository.findByCodeIn(any())).thenReturn(uoms);
        when(stockRepository.findByTenantIdAndBranchIdAndIngredientIdIn(eq(tenantId), eq(branchId), any()))
                .thenReturn(stocks);
        if (catalog != null) {
            when(menuItemCatalogRepository.findByTenantIdAndMenuItemId(eq(tenantId), eq(catalog.getMenuItemId())))
                    .thenReturn(java.util.Optional.of(catalog));
        }

        return new RecipeCostPreviewService(
                ingredientRepository, stockRepository, unitOfMeasureRepository, menuItemCatalogRepository, tenantContext);
    }

    private static Ingredient ingredient(UUID id, String name, String baseUomCode) {
        Ingredient ingredient = new Ingredient();
        ingredient.setId(id);
        ingredient.setName(name);
        ingredient.setBaseUomCode(baseUomCode);
        return ingredient;
    }

    private static UnitOfMeasure uom(String code, String baseUnitCode, BigDecimal toBaseFactor) {
        UnitOfMeasure uom = new UnitOfMeasure();
        uom.setCode(code);
        uom.setBaseUnitCode(baseUnitCode);
        uom.setToBaseFactor(toBaseFactor);
        return uom;
    }

    private static IngredientBranchStock stock(UUID ingredientId, long avgCostPaisa) {
        IngredientBranchStock stock = new IngredientBranchStock();
        stock.setIngredientId(ingredientId);
        stock.setAvgCostPaisa(BigDecimal.valueOf(avgCostPaisa));
        return stock;
    }

    private static MenuItemCatalog catalog(UUID menuItemId, long basePricePaisa) {
        MenuItemCatalog catalog = new MenuItemCatalog();
        catalog.setMenuItemId(menuItemId);
        catalog.setBasePricePaisa(basePricePaisa);
        return catalog;
    }

    @Test
    void twoLinesSumToBatchCostAndPortionCostDividesByYield() {
        UUID ingredientAId = UUID.randomUUID();
        UUID ingredientBId = UUID.randomUUID();

        RecipeCostPreviewService service = serviceWith(
                List.of(ingredient(ingredientAId, "Flour", "KG"), ingredient(ingredientBId, "Sugar", "KG")),
                List.of(uom("KG", null, BigDecimal.ONE)),
                List.of(stock(ingredientAId, 500L), stock(ingredientBId, 300L)),
                null);

        // effectiveBaseQty A = 2*1*1 / (1*10) = 0.2 -> cost = 0.2*500 = 100
        // effectiveBaseQty B = 3*1*1 / (1*10) = 0.3 -> cost = 0.3*300 = 90
        PreviewRecipeCostRequest request = new PreviewRecipeCostRequest(branchId, null, BigDecimal.valueOf(10),
                List.of(
                        new RecipeLineRequest(ingredientAId, BigDecimal.valueOf(2), "KG", null),
                        new RecipeLineRequest(ingredientBId, BigDecimal.valueOf(3), "KG", null)));

        RecipeCostPreviewDto result = service.preview(request);

        assertThat(result.batchCostPaisa()).isEqualTo(190L);
        assertThat(result.portionCostPaisa()).isEqualTo(19L);
        assertThat(result.excludedLineCount()).isZero();
    }

    @Test
    void perLineSharePercentagesSumToOneHundredWhenNoLineIsExcluded() {
        UUID ingredientAId = UUID.randomUUID();
        UUID ingredientBId = UUID.randomUUID();

        RecipeCostPreviewService service = serviceWith(
                List.of(ingredient(ingredientAId, "Flour", "KG"), ingredient(ingredientBId, "Sugar", "KG")),
                List.of(uom("KG", null, BigDecimal.ONE)),
                List.of(stock(ingredientAId, 500L), stock(ingredientBId, 300L)),
                null);

        // Line costs 100 and 90 (batch 190) -> shares round(52.63)=53, round(47.37)=47 -> sum 100.
        PreviewRecipeCostRequest request = new PreviewRecipeCostRequest(branchId, null, BigDecimal.valueOf(10),
                List.of(
                        new RecipeLineRequest(ingredientAId, BigDecimal.valueOf(2), "KG", null),
                        new RecipeLineRequest(ingredientBId, BigDecimal.valueOf(3), "KG", null)));

        RecipeCostPreviewDto result = service.preview(request);

        int shareSum = result.lines().stream().mapToInt(RecipeCostLineDto::sharePctOfBatch).sum();
        assertThat(shareSum).isEqualTo(100);
    }

    @Test
    void lineWithUnknownIngredientIsExcludedAndWarned() {
        UUID ingredientAId = UUID.randomUUID();
        UUID unknownIngredientId = UUID.randomUUID();

        RecipeCostPreviewService service = serviceWith(
                List.of(ingredient(ingredientAId, "Flour", "KG")),
                List.of(uom("KG", null, BigDecimal.ONE)),
                List.of(stock(ingredientAId, 500L)),
                null);

        PreviewRecipeCostRequest request = new PreviewRecipeCostRequest(branchId, null, BigDecimal.valueOf(10),
                List.of(
                        new RecipeLineRequest(ingredientAId, BigDecimal.valueOf(2), "KG", null),
                        new RecipeLineRequest(unknownIngredientId, BigDecimal.valueOf(3), "KG", null)));

        RecipeCostPreviewDto result = service.preview(request);

        assertThat(result.excludedLineCount()).isEqualTo(1);
        assertThat(result.batchCostPaisa()).isEqualTo(100L); // only the known line's cost
        RecipeCostLineDto excludedLine = result.lines().get(1);
        assertThat(excludedLine.lineCostPaisa()).isNull();
        assertThat(excludedLine.sharePctOfBatch()).isNull();
        assertThat(excludedLine.warning()).isNotNull();
    }

    @Test
    void lineWithUnknownUomIsExcludedAndWarned() {
        UUID ingredientAId = UUID.randomUUID();

        RecipeCostPreviewService service = serviceWith(
                List.of(ingredient(ingredientAId, "Flour", "KG")),
                List.of(), // no UOM resolves at all
                List.of(stock(ingredientAId, 500L)),
                null);

        PreviewRecipeCostRequest request = new PreviewRecipeCostRequest(branchId, null, BigDecimal.valueOf(10),
                List.of(new RecipeLineRequest(ingredientAId, BigDecimal.valueOf(2), "BADUOM", null)));

        RecipeCostPreviewDto result = service.preview(request);

        assertThat(result.excludedLineCount()).isEqualTo(1);
        assertThat(result.batchCostPaisa()).isZero();
        RecipeCostLineDto line = result.lines().get(0);
        assertThat(line.lineCostPaisa()).isNull();
        assertThat(line.warning()).isNotNull();
    }

    @Test
    void ingredientWithZeroAverageCostIsExcludedAndWarned() {
        UUID ingredientAId = UUID.randomUUID();

        RecipeCostPreviewService service = serviceWith(
                List.of(ingredient(ingredientAId, "Flour", "KG")),
                List.of(uom("KG", null, BigDecimal.ONE)),
                List.of(stock(ingredientAId, 0L)), // never costed
                null);

        PreviewRecipeCostRequest request = new PreviewRecipeCostRequest(branchId, null, BigDecimal.valueOf(10),
                List.of(new RecipeLineRequest(ingredientAId, BigDecimal.valueOf(2), "KG", null)));

        RecipeCostPreviewDto result = service.preview(request);

        assertThat(result.excludedLineCount()).isEqualTo(1);
        assertThat(result.batchCostPaisa()).isZero();
        assertThat(result.lines().get(0).warning()).isNotNull();
    }

    @Test
    void zeroBatchCostDoesNotDivideByZero() {
        UUID unknownA = UUID.randomUUID();
        UUID unknownB = UUID.randomUUID();

        RecipeCostPreviewService service = serviceWith(List.of(), List.of(), List.of(), null);

        PreviewRecipeCostRequest request = new PreviewRecipeCostRequest(branchId, null, BigDecimal.valueOf(10),
                List.of(
                        new RecipeLineRequest(unknownA, BigDecimal.valueOf(2), "KG", null),
                        new RecipeLineRequest(unknownB, BigDecimal.valueOf(3), "KG", null)));

        RecipeCostPreviewDto result = service.preview(request);

        assertThat(result.batchCostPaisa()).isZero();
        assertThat(result.portionCostPaisa()).isZero();
        assertThat(result.excludedLineCount()).isEqualTo(2);
        assertThat(result.lines()).allSatisfy(line -> assertThat(line.warning()).isNotNull());
    }

    @Test
    void foodCostPctIsNullWhenMenuItemPriceIsZeroOrAbsent() {
        UUID ingredientAId = UUID.randomUUID();
        UUID menuItemId = UUID.randomUUID();

        // Case 1: no menuItemId at all.
        RecipeCostPreviewService serviceNoMenuItem = serviceWith(
                List.of(ingredient(ingredientAId, "Flour", "KG")),
                List.of(uom("KG", null, BigDecimal.ONE)),
                List.of(stock(ingredientAId, 500L)),
                null);
        PreviewRecipeCostRequest requestNoMenuItem = new PreviewRecipeCostRequest(branchId, null, BigDecimal.valueOf(10),
                List.of(new RecipeLineRequest(ingredientAId, BigDecimal.valueOf(2), "KG", null)));
        assertThat(serviceNoMenuItem.preview(requestNoMenuItem).foodCostPct()).isNull();

        // Case 2: menuItemId present but catalog price is zero.
        RecipeCostPreviewService serviceZeroPrice = serviceWith(
                List.of(ingredient(ingredientAId, "Flour", "KG")),
                List.of(uom("KG", null, BigDecimal.ONE)),
                List.of(stock(ingredientAId, 500L)),
                catalog(menuItemId, 0L));
        PreviewRecipeCostRequest requestZeroPrice = new PreviewRecipeCostRequest(branchId, menuItemId, BigDecimal.valueOf(10),
                List.of(new RecipeLineRequest(ingredientAId, BigDecimal.valueOf(2), "KG", null)));
        assertThat(serviceZeroPrice.preview(requestZeroPrice).foodCostPct()).isNull();
    }

    @Test
    void foodCostPctIsComputedToOneDecimalPlaceWhenMenuItemPriceIsKnown() {
        UUID ingredientAId = UUID.randomUUID();
        UUID menuItemId = UUID.randomUUID();

        // portionCost = 19 (from the two-line scenario above scaled to a single 190-paisa batch over
        // 10 servings), menuItemPricePaisa = 200 -> foodCostPct = 19/200*100 = 9.5.
        RecipeCostPreviewService service = serviceWith(
                List.of(ingredient(ingredientAId, "Flour", "KG")),
                List.of(uom("KG", null, BigDecimal.ONE)),
                List.of(stock(ingredientAId, 950L)),
                catalog(menuItemId, 200L));

        // effectiveBaseQty = 2*1*1/(1*10) = 0.2 -> lineCost = 0.2*950 = 190 -> portionCost = 19.
        PreviewRecipeCostRequest request = new PreviewRecipeCostRequest(branchId, menuItemId, BigDecimal.valueOf(10),
                List.of(new RecipeLineRequest(ingredientAId, BigDecimal.valueOf(2), "KG", null)));

        RecipeCostPreviewDto result = service.preview(request);

        assertThat(result.portionCostPaisa()).isEqualTo(19L);
        assertThat(result.foodCostPct()).isEqualByComparingTo(new BigDecimal("9.5"));
    }

    @Test
    void yieldPctIsAppliedThroughUomConverter() {
        UUID ingredientAId = UUID.randomUUID();

        RecipeCostPreviewService service = serviceWith(
                List.of(ingredient(ingredientAId, "Flour", "KG")),
                List.of(uom("KG", null, BigDecimal.ONE)),
                List.of(stock(ingredientAId, 1000L)),
                null);

        PreviewRecipeCostRequest requestAt100 = new PreviewRecipeCostRequest(branchId, null, BigDecimal.valueOf(5),
                List.of(new RecipeLineRequest(ingredientAId, BigDecimal.valueOf(5), "KG", BigDecimal.valueOf(100))));
        PreviewRecipeCostRequest requestAt80 = new PreviewRecipeCostRequest(branchId, null, BigDecimal.valueOf(5),
                List.of(new RecipeLineRequest(ingredientAId, BigDecimal.valueOf(5), "KG", BigDecimal.valueOf(80))));

        long costAt100 = service.preview(requestAt100).batchCostPaisa();
        long costAt80 = service.preview(requestAt80).batchCostPaisa();

        assertThat(costAt80).isGreaterThan(costAt100);

        io.restaurantos.inventory.domain.model.RecipeLine lineAt100 = new io.restaurantos.inventory.domain.model.RecipeLine();
        lineAt100.setQty(BigDecimal.valueOf(5));
        lineAt100.setYieldPct(BigDecimal.valueOf(100));
        io.restaurantos.inventory.domain.model.RecipeLine lineAt80 = new io.restaurantos.inventory.domain.model.RecipeLine();
        lineAt80.setQty(BigDecimal.valueOf(5));
        lineAt80.setYieldPct(BigDecimal.valueOf(80));

        BigDecimal expectedQtyAt100 =
                UomConverter.effectiveBaseQty(lineAt100, 1, BigDecimal.valueOf(5), BigDecimal.ONE);
        BigDecimal expectedQtyAt80 =
                UomConverter.effectiveBaseQty(lineAt80, 1, BigDecimal.valueOf(5), BigDecimal.ONE);

        long expectedCostAt100 = expectedQtyAt100.multiply(BigDecimal.valueOf(1000L))
                .setScale(0, java.math.RoundingMode.HALF_UP).longValueExact();
        long expectedCostAt80 = expectedQtyAt80.multiply(BigDecimal.valueOf(1000L))
                .setScale(0, java.math.RoundingMode.HALF_UP).longValueExact();

        assertThat(costAt100).isEqualTo(expectedCostAt100);
        assertThat(costAt80).isEqualTo(expectedCostAt80);
    }
}
