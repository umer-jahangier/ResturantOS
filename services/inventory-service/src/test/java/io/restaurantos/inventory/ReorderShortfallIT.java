package io.restaurantos.inventory;

import io.restaurantos.inventory.domain.model.Ingredient;
import io.restaurantos.inventory.domain.model.ItemCategory;
import io.restaurantos.inventory.dto.ReorderDtos.ReorderShortfallDto;
import io.restaurantos.inventory.dto.ReorderDtos.ReorderShortfallsResponse;
import io.restaurantos.inventory.repository.IngredientBranchStockRepository;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.ItemCategoryRepository;
import io.restaurantos.inventory.service.ReorderSuggestionService;
import io.restaurantos.shared.feature.FeatureFlagService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * The first reader of {@code ingredients.par_level} and
 * {@code item_categories.exclude_from_po_suggestions}.
 *
 * <p>Both fields were settable from 08.2-01/08.2-09 onward and consumed by NOTHING: a manager
 * could record "keep 25 kg on the shelf", see it stored and displayed back faithfully, and have it
 * change no behaviour anywhere. Meanwhile {@code reorderPoint} sitting beside it on the same form
 * drove real low-stock alerts — so the system could say something was low but never how much to
 * buy.
 *
 * <p>The pair, and the reason these tests care about the distinction:
 * <ul>
 *   <li>{@code reorderPoint} — WHEN to order (the alarm line).</li>
 *   <li>{@code parLevel} — HOW MUCH to order (the target to top back up to).</li>
 * </ul>
 */
class ReorderShortfallIT extends InventoryTestBase {

    @Autowired TenantContext tenantContext;
    @Autowired IngredientRepository ingredientRepository;
    @Autowired IngredientBranchStockRepository stockRepository;
    @Autowired ItemCategoryRepository itemCategoryRepository;
    @Autowired ReorderSuggestionService reorderSuggestionService;

    @MockitoBean FeatureFlagService featureFlagService;

    UUID tenantId;
    UUID branchId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);
        when(featureFlagService.isEnabled(any(), any())).thenReturn(true);
    }

    // ---- fixtures ----

    private UUID seedCategory(String name, UUID parentId, boolean excludeFromPoSuggestions) {
        ItemCategory category = new ItemCategory();
        category.setTenantId(tenantId);
        category.setName(name + " " + UUID.randomUUID());
        category.setParentId(parentId);
        category.setLevel((short) (parentId == null ? 1 : 2));
        category.setExcludeFromPoSuggestions(excludeFromPoSuggestions);
        return itemCategoryRepository.save(category).getId();
    }

    private Ingredient seedItem(String name, UUID categoryId, BigDecimal reorderPoint,
                                 BigDecimal parLevel, BigDecimal qtyOnHand) {
        Ingredient ingredient = new Ingredient();
        ingredient.setTenantId(tenantId);
        ingredient.setName(name);
        ingredient.setSku("SKU-" + UUID.randomUUID());
        ingredient.setBaseUomCode("KG");
        ingredient.setMeasureType("WEIGHT");
        ingredient.setCategoryId(categoryId != null
                ? categoryId
                : ingredientRepository.resolveOrCreateCategoryId(tenantId, null));
        ingredient.setReorderPoint(reorderPoint);
        ingredient.setParLevel(parLevel);
        ingredient.setActive(true);
        Ingredient saved = ingredientRepository.save(ingredient);
        if (qtyOnHand != null) {
            InventoryFixtures.seedStock(stockRepository, tenantId, branchId, saved.getId(), qtyOnHand, 1_000L);
        }
        return saved;
    }

    private Optional<ReorderShortfallDto> rowFor(List<ReorderShortfallDto> items, UUID ingredientId) {
        return items.stream().filter(dto -> dto.ingredientId().equals(ingredientId)).findFirst();
    }

    // ---- the core arithmetic ----

    @Test
    void suggestedQtyIsParMinusOnHandNotParMinusReorderPoint() {
        UUID id = seedItem("Chicken", null, BigDecimal.valueOf(10), BigDecimal.valueOf(25),
                BigDecimal.valueOf(4)).getId();

        ReorderShortfallsResponse response = reorderSuggestionService.shortfalls(branchId);

        // 25 par - 4 on hand = 21. NOT 25 - 10: the reorder point is the trigger, never a term in
        // the quantity, and confusing the two under-orders by exactly the buffer it exists to hold.
        assertThat(rowFor(response.items(), id)).hasValueSatisfying(row -> {
            assertThat(row.suggestedQty()).isEqualByComparingTo(BigDecimal.valueOf(21));
            assertThat(row.blockedReason()).isNull();
        });
    }

    @Test
    void anItemExactlyAtItsReorderPointIsIncluded() {
        UUID id = seedItem("Flour", null, BigDecimal.valueOf(10), BigDecimal.valueOf(30),
                BigDecimal.valueOf(10)).getId();

        // "At or below", matching StockLevelService's belowReorderPoint flag exactly. If the two
        // disagreed, the Stock page would highlight a row this list omits.
        assertThat(rowFor(reorderSuggestionService.shortfalls(branchId).items(), id))
                .hasValueSatisfying(row ->
                        assertThat(row.suggestedQty()).isEqualByComparingTo(BigDecimal.valueOf(20)));
    }

    @Test
    void anItemAboveItsReorderPointIsAbsent() {
        UUID id = seedItem("Sugar", null, BigDecimal.valueOf(10), BigDecimal.valueOf(30),
                BigDecimal.valueOf(11)).getId();

        assertThat(rowFor(reorderSuggestionService.shortfalls(branchId).items(), id)).isEmpty();
    }

    @Test
    void anItemWithNoStockRowCountsAsZeroOnHandRatherThanBeingSkipped() {
        // A brand-new item nobody has received yet is exactly the thing most worth ordering.
        // Skipping it for want of a stock row would make the list quietly incomplete.
        UUID id = seedItem("Saffron", null, BigDecimal.valueOf(5), BigDecimal.valueOf(20), null).getId();

        assertThat(rowFor(reorderSuggestionService.shortfalls(branchId).items(), id))
                .hasValueSatisfying(row -> {
                    assertThat(row.qtyOnHand()).isEqualByComparingTo(BigDecimal.ZERO);
                    assertThat(row.suggestedQty()).isEqualByComparingTo(BigDecimal.valueOf(20));
                });
    }

    @Test
    void anItemWithNoReorderPointIsNeverSuggested() {
        // Zero means "no alarm line set" — the same reading StockLevelService gives it.
        UUID id = seedItem("Garnish", null, BigDecimal.ZERO, BigDecimal.valueOf(20),
                BigDecimal.ZERO).getId();

        assertThat(rowFor(reorderSuggestionService.shortfalls(branchId).items(), id)).isEmpty();
    }

    // ---- the "we can't answer that" cases ----

    @Test
    void anItemWithNoParLevelIsReportedRatherThanSilentlyDropped() {
        UUID id = seedItem("Cumin", null, BigDecimal.valueOf(10), BigDecimal.ZERO,
                BigDecimal.valueOf(2)).getId();

        ReorderShortfallsResponse response = reorderSuggestionService.shortfalls(branchId);

        // It IS low, so hiding it would tell a manager everything else is fine. It just has no
        // target to order up to, and saying so is what prompts them to set one.
        assertThat(rowFor(response.items(), id)).hasValueSatisfying(row -> {
            assertThat(row.suggestedQty()).isNull();
            assertThat(row.blockedReason()).contains("No par level set");
        });
        assertThat(response.blockedCount()).isEqualTo(1);
    }

    @Test
    void aParLevelAtOrBelowTheReorderPointIsRefusedAsAQuantity() {
        UUID id = seedItem("Cinnamon", null, BigDecimal.valueOf(10), BigDecimal.valueOf(10),
                BigDecimal.valueOf(2)).getId();

        // Topping up to the alarm line leaves the item "low" the moment the delivery lands, so it
        // would reappear on this list tomorrow. That is a misconfiguration, not a quantity.
        assertThat(rowFor(reorderSuggestionService.shortfalls(branchId).items(), id))
                .hasValueSatisfying(row -> {
                    assertThat(row.suggestedQty()).isNull();
                    assertThat(row.blockedReason()).contains("at or below the reorder point");
                });
    }

    @Test
    void actionableRowsSortAboveBlockedOnes() {
        seedItem("Aaa blocked", null, BigDecimal.valueOf(10), BigDecimal.ZERO, BigDecimal.ONE);
        seedItem("Zzz orderable", null, BigDecimal.valueOf(10), BigDecimal.valueOf(30), BigDecimal.ONE);

        List<ReorderShortfallDto> items = reorderSuggestionService.shortfalls(branchId).items();

        // Alphabetically "Aaa" wins, but a manager scanning this wants what they can act on now,
        // with the "configure something first" rows gathered underneath.
        assertThat(items.get(0).ingredientName()).isEqualTo("Zzz orderable");
        assertThat(items.get(1).ingredientName()).isEqualTo("Aaa blocked");
    }

    // ---- category opt-out ----

    @Test
    void anExcludedCategoryIsLeftOffEntirely() {
        UUID excluded = seedCategory("Beverages", null, true);
        UUID id = seedItem("Cola", excluded, BigDecimal.valueOf(10), BigDecimal.valueOf(30),
                BigDecimal.ONE).getId();

        assertThat(rowFor(reorderSuggestionService.shortfalls(branchId).items(), id)).isEmpty();
    }

    @Test
    void aChildInheritsItsParentsExclusion() {
        UUID parent = seedCategory("Beverages", null, true);
        UUID child = seedCategory("Soft drinks", parent, false);
        UUID id = seedItem("Lemonade", child, BigDecimal.valueOf(10), BigDecimal.valueOf(30),
                BigDecimal.ONE).getId();

        // Deliberately NOT most-specific-wins, unlike the GL accounts and the variance cap. Those
        // answer "which value applies here?"; this is an opt-out, and turning suggestions off for
        // "Beverages" is a statement about everything underneath it.
        assertThat(rowFor(reorderSuggestionService.shortfalls(branchId).items(), id)).isEmpty();
    }

    @Test
    void anUnflaggedSiblingTreeIsUnaffected() {
        seedCategory("Beverages", null, true);
        UUID produce = seedCategory("Produce", null, false);
        UUID id = seedItem("Tomatoes", produce, BigDecimal.valueOf(10), BigDecimal.valueOf(30),
                BigDecimal.ONE).getId();

        assertThat(rowFor(reorderSuggestionService.shortfalls(branchId).items(), id)).isPresent();
    }

    // ---- scoping ----

    @Test
    void anotherBranchesStockDoesNotSatisfyThisBranchesShortfall() {
        UUID otherBranch = UUID.randomUUID();
        Ingredient ingredient = seedItem("Butter", null, BigDecimal.valueOf(10), BigDecimal.valueOf(25), null);
        InventoryFixtures.seedStock(stockRepository, tenantId, otherBranch, ingredient.getId(),
                BigDecimal.valueOf(100), 1_000L);

        // 100 kg in the other kitchen does not stop this one running out.
        assertThat(rowFor(reorderSuggestionService.shortfalls(branchId).items(), ingredient.getId()))
                .hasValueSatisfying(row ->
                        assertThat(row.qtyOnHand()).isEqualByComparingTo(BigDecimal.ZERO));
    }

    @Test
    void anArchivedItemIsNeverSuggested() {
        Ingredient ingredient = seedItem("Discontinued", null, BigDecimal.valueOf(10),
                BigDecimal.valueOf(30), BigDecimal.ONE);
        ingredient.setActive(false);
        ingredientRepository.save(ingredient);

        assertThat(rowFor(reorderSuggestionService.shortfalls(branchId).items(), ingredient.getId()))
                .isEmpty();
    }
}
