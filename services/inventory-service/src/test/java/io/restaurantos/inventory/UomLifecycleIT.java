package io.restaurantos.inventory;

import io.restaurantos.inventory.domain.model.Ingredient;
import io.restaurantos.inventory.domain.model.IngredientUomConversion;
import io.restaurantos.inventory.domain.model.UnitOfMeasure;
import io.restaurantos.inventory.dto.InventoryDtos.UomDto;
import io.restaurantos.inventory.dto.InventoryDtos.UpdateUomRequest;
import io.restaurantos.inventory.exception.UomInvalidException;
import io.restaurantos.inventory.feign.PurchasingUomUsageClient;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.IngredientUomConversionRepository;
import io.restaurantos.inventory.repository.UnitOfMeasureRepository;
import io.restaurantos.inventory.service.GrnUomResolver;
import io.restaurantos.inventory.service.IngredientService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * A tenant can correct and retire a unit, and cannot pull one out from under the records that name
 * it.
 *
 * <h2>Why this exists as a BUILD GATE and not only as a live script</h2>
 *
 * Finding F-31-04: {@code UnitOfMeasureController} exposed exactly list and create. {@code PUT} and
 * {@code archive} both answered <b>404</b> against the live stack, while every sibling entity —
 * ingredient, item category, storage location — had had them for phases. A tenant that mistyped a
 * unit's factor could not correct it, and a unit created by accident appeared in every picker
 * forever. Floating Terrace's registry still contains a unit coded {@code TETS}, named "TEST", with
 * a factor of 5 grams.
 *
 * <p>Plan 36-05 fixed it and proved it live in {@code scripts/e2e/phase31-master-data-e2e.sh}
 * (35/0). A live script is not a build gate: it runs when someone runs it. These seven behaviours
 * are the ones a regression would silently take away, so they are asserted here too — live proof
 * and a build gate, not either alone.
 *
 * <p>Run with failsafe:
 * {@code mvn -pl services/inventory-service verify -Dit.test=UomLifecycleIT}.
 * {@code mvn test -Dtest=…IT} executes ZERO tests and reports success.
 */
@DisplayName("A unit of measure can be corrected and retired, and not out from under its references")
class UomLifecycleIT extends InventoryTestBase {

    /**
     * The cross-database half of the retire guard. Purchasing owns {@code vendor_items.pack_uom},
     * which no constraint here can reach; this context has no purchasing-service, so the seam is
     * stubbed and each test states what the vendor catalog is supposed to say.
     */
    @MockitoBean
    private PurchasingUomUsageClient purchasingUomUsageClient;

    @Autowired private IngredientService ingredientService;
    @Autowired private GrnUomResolver grnUomResolver;
    @Autowired private UnitOfMeasureRepository uomRepository;
    @Autowired private IngredientRepository ingredientRepository;
    @Autowired private IngredientUomConversionRepository conversionRepository;
    @Autowired private TenantContext tenantContext;

    private UUID tenantId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        tenantContext.set(tenantId, UUID.randomUUID(), UUID.randomUUID(), null);
        // Default: the vendor catalog packs in nothing. Tests that need the opposite say so.
        when(purchasingUomUsageClient.uomUsage(any(), anyString()))
                .thenReturn(new PurchasingUomUsageClient.UomUsageResponse(0L));
    }

    /** A house unit in the WEIGHT family, derived from grams. */
    private UnitOfMeasure houseUnit(String code, BigDecimal factor) {
        return InventoryFixtures.seedUom(uomRepository, tenantId, code, "House " + code,
                "WEIGHT", "G", factor);
    }

    private UomDto find(List<UomDto> all, String code) {
        return all.stream().filter(u -> code.equalsIgnoreCase(u.code())).findFirst().orElse(null);
    }

    // ── 1. A name and a derived unit's factor can be changed ────────────────────────────────

    @Test
    @DisplayName("1 — the name and the conversion factor can be corrected, and the next list shows it")
    void nameAndFactorAreCorrectable() {
        UnitOfMeasure unit = houseUnit("TRAY", new BigDecimal("250"));

        UomDto saved = ingredientService.updateUom(unit.getId(),
                new UpdateUomRequest("Baking tray", "WEIGHT", "G", new BigDecimal("300")));

        assertThat(saved.name()).isEqualTo("Baking tray");
        assertThat(saved.toBaseFactor()).isEqualByComparingTo("300");

        UomDto reread = find(ingredientService.listUoms(), "TRAY");
        assertThat(reread).as("the change must be visible in the next list, not just the response")
                .isNotNull();
        assertThat(reread.name()).isEqualTo("Baking tray");
        assertThat(reread.toBaseFactor()).isEqualByComparingTo("300");
    }

    // ── 2. The code cannot be changed ───────────────────────────────────────────────────────

    @Test
    @DisplayName("2 — a unit's CODE is not changeable, and the request shape does not even offer it")
    void theCodeCannotBeChanged() {
        UnitOfMeasure unit = houseUnit("CASE", new BigDecimal("24"));

        // The strongest possible form of "refused": there is no field to send. A unit code is a
        // foreign key BY VALUE into ingredients.base_uom_code, ingredients.recipe_uom_code,
        // ingredient_uom_conversions on both sides, and purchasing_db.vendor_items.pack_uom.
        // Nothing can follow those references backwards, so a rename orphans all of them silently.
        assertThat(UpdateUomRequest.class.getRecordComponents())
                .as("UpdateUomRequest must not carry a 'code' component — a rename is unrepresentable")
                .noneMatch(c -> c.getName().equals("code"));

        ingredientService.updateUom(unit.getId(),
                new UpdateUomRequest("Renamed but same code", "WEIGHT", "G", new BigDecimal("24")));

        assertThat(uomRepository.findById(unit.getId()).orElseThrow().getCode())
                .as("the stored code is untouched by an update")
                .isEqualTo("CASE");
    }

    // ── 3. The family-base invariant survives the update path ───────────────────────────────

    @Test
    @DisplayName("3 — a change that breaks the family-base invariant is refused, as on create")
    void familyBaseInvariantHoldsOnUpdate() {
        UnitOfMeasure unit = houseUnit("SACK", new BigDecimal("50"));

        // A unit with no base IS the base of its own family, so its factor must be exactly 1.
        assertThatThrownBy(() -> ingredientService.updateUom(unit.getId(),
                new UpdateUomRequest("Sack", "WEIGHT", null, new BigDecimal("50"))))
                .isInstanceOf(UomInvalidException.class)
                .hasMessageContaining("factor must be 1");

        // A derived unit may not point at another derived unit — conversions do not chain.
        UnitOfMeasure kg = InventoryFixtures.seedUom(uomRepository, tenantId, "KG", "Kilogram",
                "WEIGHT", "G", new BigDecimal("1000"));
        assertThatThrownBy(() -> ingredientService.updateUom(unit.getId(),
                new UpdateUomRequest("Sack", "WEIGHT", kg.getCode(), new BigDecimal("50"))))
                .isInstanceOf(UomInvalidException.class)
                .hasMessageContaining("itself measured in");

        // And the dimension must agree.
        InventoryFixtures.seedUom(uomRepository, tenantId, "ML", "Millilitre", "VOLUME", null,
                BigDecimal.ONE);
        assertThatThrownBy(() -> ingredientService.updateUom(unit.getId(),
                new UpdateUomRequest("Sack", "WEIGHT", "ML", new BigDecimal("50"))))
                .isInstanceOf(UomInvalidException.class)
                .hasMessageContaining("measures");
    }

    // ── 4. The retire guard, one case per kind of reference ─────────────────────────────────

    @Test
    @DisplayName("4a — a unit ingredients are STOCKED in cannot be retired, and the refusal counts them")
    void cannotRetireAUnitIngredientsAreStockedIn() {
        UnitOfMeasure unit = houseUnit("DRUM", new BigDecimal("200"));
        InventoryFixtures.seedIngredient(ingredientRepository, tenantId, "Oil", "OIL-1",
                unit.getCode(), BigDecimal.ONE);

        assertThatThrownBy(() -> ingredientService.archiveUom(unit.getId()))
                .isInstanceOf(UomInvalidException.class)
                .hasMessageContaining("1 ingredient(s) stocked in it")
                .hasMessageContaining("DRUM");

        assertThat(uomRepository.findById(unit.getId()).orElseThrow().getArchivedAt())
                .as("a refused retire must not have set the timestamp anyway")
                .isNull();
    }

    @Test
    @DisplayName("4b — a unit used as an ingredient's RECIPE unit cannot be retired")
    void cannotRetireAUnitUsedAsARecipeUnit() {
        UnitOfMeasure unit = houseUnit("SCOOP", new BigDecimal("30"));
        Ingredient ingredient = InventoryFixtures.seedIngredient(ingredientRepository, tenantId,
                "Flour", "FLR-1", "G", BigDecimal.ONE);
        ingredient.setRecipeUomCode(unit.getCode());
        ingredientRepository.save(ingredient);

        assertThatThrownBy(() -> ingredientService.archiveUom(unit.getId()))
                .isInstanceOf(UomInvalidException.class)
                .hasMessageContaining("recipe unit");
    }

    @Test
    @DisplayName("4c — a CONVERSION row naming the unit on either side blocks the retire")
    void cannotRetireAUnitNamedByAConversionRow() {
        UnitOfMeasure unit = houseUnit("PINCH", new BigDecimal("2"));
        Ingredient ingredient = InventoryFixtures.seedIngredient(ingredientRepository, tenantId,
                "Salt", "SLT-1", "G", BigDecimal.ONE);

        // The "to" side, deliberately: retiring the target of a conversion breaks it exactly as
        // thoroughly as retiring its source, and a guard that only checked one side would pass.
        IngredientUomConversion conversion = new IngredientUomConversion();
        conversion.setTenantId(tenantId);
        conversion.setIngredientId(ingredient.getId());
        conversion.setFromUomCode("G");
        conversion.setToUomCode(unit.getCode());
        conversion.setFactor(new BigDecimal("2"));
        conversionRepository.save(conversion);

        assertThatThrownBy(() -> ingredientService.archiveUom(unit.getId()))
                .isInstanceOf(UomInvalidException.class)
                .hasMessageContaining("conversion row");
    }

    @Test
    @DisplayName("4d — a VENDOR CATALOG row in another database blocks the retire")
    void cannotRetireAUnitAVendorCatalogPacksIn() {
        UnitOfMeasure unit = houseUnit("CARTON", new BigDecimal("500"));
        // Nothing in inventory_db references it — the only reference is across the boundary.
        when(purchasingUomUsageClient.uomUsage(any(), anyString()))
                .thenReturn(new PurchasingUomUsageClient.UomUsageResponse(3L));

        assertThatThrownBy(() -> ingredientService.archiveUom(unit.getId()))
                .isInstanceOf(UomInvalidException.class)
                .hasMessageContaining("3 vendor catalog row(s)");
    }

    @Test
    @DisplayName("4e — if the vendor catalog cannot be REACHED, the retire is refused, not assumed safe")
    void cannotRetireWhenTheCrossDatabaseGuardCannotBeEvaluated() {
        UnitOfMeasure unit = houseUnit("PALLET", new BigDecimal("1000"));
        when(purchasingUomUsageClient.uomUsage(any(), anyString()))
                .thenThrow(new RuntimeException("connection refused"));

        // The two failure modes are NOT symmetric. Retiring a unit is never urgent; a unit retired
        // out from under a vendor catalog row makes every receipt against it convert at face value,
        // silently wrong in both quantity and cost. So: no fallback, no assumption of zero.
        assertThatThrownBy(() -> ingredientService.archiveUom(unit.getId()))
                .isInstanceOf(UomInvalidException.class)
                .hasMessageContaining("could not be checked");

        assertThat(uomRepository.findById(unit.getId()).orElseThrow().getArchivedAt()).isNull();
    }

    // ── 5. Retired: gone from the pickers, still resolvable by conversion ───────────────────

    @Test
    @DisplayName("5 — a retired unit leaves the pickers and STILL converts")
    void retiredUnitLeavesThePickersAndStillConverts() {
        // A gram-stocked ingredient, and a house unit of 250 g that nothing references.
        Ingredient ingredient = InventoryFixtures.seedIngredient(ingredientRepository, tenantId,
                "Sugar", "SUG-1", "G", BigDecimal.ONE);
        InventoryFixtures.seedUom(uomRepository, tenantId, "G", "Gram", "WEIGHT", null, BigDecimal.ONE);
        UnitOfMeasure unit = houseUnit("CUPFUL", new BigDecimal("250"));

        ingredientService.archiveUom(unit.getId());

        assertThat(find(ingredientService.listUoms(), "CUPFUL"))
                .as("a picker must never offer a retired unit")
                .isNull();
        assertThat(find(ingredientService.listUoms(true), "CUPFUL"))
                .as("the setup screen must still SEE it, so it does not vanish unexplained")
                .isNotNull();

        // THE HALF THAT MATTERS. A goods receipt recorded last year in this unit must still
        // convert, or the stock valuation it produced becomes unreproducible. The conversion path
        // deliberately does not come through listUoms, and this is the assertion that keeps it so.
        GrnUomResolver.BaseUnitReceipt received = grnUomResolver.toBaseUnits(
                tenantId, ingredient.getId(), UUID.randomUUID(),
                new BigDecimal("2"), new BigDecimal("500"), "CUPFUL");
        assertThat(received.qtyInBaseUom())
                .as("2 CUPFUL of 250 g is 500 g — a retired unit still converts")
                .isEqualByComparingTo("500");
        assertThat(received.converted()).isTrue();
    }

    // ── 6. Restore ──────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("6 — a retired unit can be brought back")
    void aRetiredUnitCanBeRestored() {
        UnitOfMeasure unit = houseUnit("BUNCH", new BigDecimal("120"));
        ingredientService.archiveUom(unit.getId());
        assertThat(find(ingredientService.listUoms(), "BUNCH")).isNull();

        UomDto restored = ingredientService.restoreUom(unit.getId());

        assertThat(restored.archivedAt()).isNull();
        assertThat(find(ingredientService.listUoms(), "BUNCH"))
                .as("a restored unit is offered by the pickers again")
                .isNotNull();
    }

    // ── 7. Idempotent ───────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("7 — retiring an already-retired unit succeeds and changes nothing")
    void retiringIsIdempotent() {
        UnitOfMeasure unit = houseUnit("SHEET", new BigDecimal("400"));

        UomDto first = ingredientService.archiveUom(unit.getId());
        assertThat(first.archivedAt()).isNotNull();

        UomDto second = ingredientService.archiveUom(unit.getId());

        assertThat(second.archivedAt())
                .as("a double click must not move the timestamp, and must not be an error")
                .isEqualTo(first.archivedAt());
    }

    // ── The invariant behind all of it ──────────────────────────────────────────────────────

    @Test
    @DisplayName("a unit row is NEVER deleted — retirement is the only way out")
    void aUnitIsNeverDeleted() {
        UnitOfMeasure unit = houseUnit("KEG", new BigDecimal("50"));
        long before = uomRepository.count();

        ingredientService.archiveUom(unit.getId());

        assertThat(uomRepository.count())
                .as("retiring must not remove the row: its CODE is referenced by value from "
                        + "ingredients, conversion rows and another service's vendor catalog, and "
                        + "none of those references can be followed backwards")
                .isEqualTo(before);
        assertThat(uomRepository.findById(unit.getId())).isPresent();

        // And no delete method is exposed on the service at all — the strongest form of the rule.
        assertThat(List.of(IngredientService.class.getMethods()).stream()
                .map(Method::getName)
                .filter(n -> n.toLowerCase().contains("uom"))
                .toList())
                .as("IngredientService must expose no delete-a-unit operation")
                .noneMatch(n -> n.toLowerCase().startsWith("delete"));
    }
}
