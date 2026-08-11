package io.restaurantos.inventory;

import io.restaurantos.inventory.domain.model.UnitOfMeasure;
import io.restaurantos.inventory.service.IngredientUomFactorResolver;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The arithmetic that decides how much stock an order actually consumes.
 *
 * <p>The first test here is the one that matters: it is the exact case that was live-broken.
 * Basmati Rice is stocked in KG; a recipe line says 0.25 KG; the old code multiplied by KG's
 * {@code to_base_factor} of 1000 and depleted 250. On the live stack that took 100 KG of stock to
 * &minus;400 across two plates and posted a COGS journal entry of PKR 125,000 against PKR 2,900 of
 * revenue. Every assertion below is a ratio, never a raw {@code to_base_factor}.
 */
class IngredientUomFactorResolverTest {

    private static UnitOfMeasure uom(String code, String baseUnitCode, String toBaseFactor) {
        UnitOfMeasure u = new UnitOfMeasure();
        u.setCode(code);
        u.setBaseUnitCode(baseUnitCode);
        u.setToBaseFactor(new BigDecimal(toBaseFactor));
        return u;
    }

    private static final UnitOfMeasure KG = uom("KG", "G", "1000");
    private static final UnitOfMeasure G = uom("G", null, "1");
    private static final UnitOfMeasure LB = uom("LB", "G", "453.59237");
    private static final UnitOfMeasure L = uom("L", "ML", "1000");
    private static final UnitOfMeasure ML = uom("ML", null, "1");
    private static final UnitOfMeasure EACH = uom("EACH", null, "1");
    private static final UnitOfMeasure DOZEN = uom("DOZEN", "EACH", "12");

    @Test
    @DisplayName("KG line against a KG-stocked ingredient is a no-op — NOT 1000 (the live defect)")
    void sameUnitIsOne() {
        assertThat(IngredientUomFactorResolver.factorToIngredientBase(KG, "KG", KG))
                .hasValueSatisfying(f -> assertThat(f).isEqualByComparingTo("1"));
    }

    @Test
    @DisplayName("KG line against a G-stocked ingredient is 1000")
    void derivedIntoFamilyBase() {
        assertThat(IngredientUomFactorResolver.factorToIngredientBase(KG, "G", G))
                .hasValueSatisfying(f -> assertThat(f).isEqualByComparingTo("1000"));
    }

    @Test
    @DisplayName("G line against a KG-stocked ingredient is 0.001 — the inverse direction")
    void familyBaseIntoDerived() {
        assertThat(IngredientUomFactorResolver.factorToIngredientBase(G, "KG", KG))
                .hasValueSatisfying(f -> assertThat(f).isEqualByComparingTo("0.001"));
    }

    @Test
    @DisplayName("LB line against a KG-stocked ingredient is the ratio of both factors")
    void derivedIntoDerived() {
        assertThat(IngredientUomFactorResolver.factorToIngredientBase(LB, "KG", KG))
                .hasValueSatisfying(f -> assertThat(f).isEqualByComparingTo("0.45359237"));
    }

    @Test
    @DisplayName("DOZEN into EACH is 12; EACH into EACH is 1")
    void countFamily() {
        assertThat(IngredientUomFactorResolver.factorToIngredientBase(DOZEN, "EACH", EACH))
                .hasValueSatisfying(f -> assertThat(f).isEqualByComparingTo("12"));
        assertThat(IngredientUomFactorResolver.factorToIngredientBase(EACH, "EACH", EACH))
                .hasValueSatisfying(f -> assertThat(f).isEqualByComparingTo("1"));
    }

    @Test
    @DisplayName("Volume line against a weight-stocked ingredient is undefined, never a guessed 1")
    void crossFamilyIsEmpty() {
        assertThat(IngredientUomFactorResolver.factorToIngredientBase(L, "KG", KG)).isEmpty();
        assertThat(IngredientUomFactorResolver.factorToIngredientBase(KG, "ML", ML)).isEmpty();
        assertThat(IngredientUomFactorResolver.factorToIngredientBase(DOZEN, "G", G)).isEmpty();
    }

    @Test
    @DisplayName("Unit codes compare case-insensitively — they are not normalised at rest")
    void caseInsensitive() {
        UnitOfMeasure lowerKg = uom("kg", "g", "1000");
        assertThat(IngredientUomFactorResolver.factorToIngredientBase(lowerKg, "KG", KG))
                .hasValueSatisfying(f -> assertThat(f).isEqualByComparingTo("1"));
        assertThat(IngredientUomFactorResolver.factorToIngredientBase(lowerKg, "G", G))
                .hasValueSatisfying(f -> assertThat(f).isEqualByComparingTo("1000"));
    }

    @Test
    @DisplayName("An ingredient stocked in a unit the registry does not know still resolves when "
            + "that unit is the line unit's family base")
    void unknownStockUnitFallsBackToFamilyBaseOnly() {
        assertThat(IngredientUomFactorResolver.factorToIngredientBase(KG, "G", null))
                .hasValueSatisfying(f -> assertThat(f).isEqualByComparingTo("1000"));
        // Same code, no registry row: still a no-op, established before the registry is consulted.
        assertThat(IngredientUomFactorResolver.factorToIngredientBase(KG, "KG", null))
                .hasValueSatisfying(f -> assertThat(f).isEqualByComparingTo("1"));
        // Anything else is unprovable and must stay empty rather than fall back to one.
        assertThat(IngredientUomFactorResolver.factorToIngredientBase(KG, "LB", null)).isEmpty();
    }

    @Test
    @DisplayName("Null and blank inputs are undefined, not one")
    void nullsAreEmpty() {
        assertThat(IngredientUomFactorResolver.factorToIngredientBase(null, "KG", KG)).isEmpty();
        assertThat(IngredientUomFactorResolver.factorToIngredientBase(KG, null, KG)).isEmpty();
        assertThat(IngredientUomFactorResolver.factorToIngredientBase(KG, "  ", KG)).isEmpty();
    }

    @Test
    @DisplayName("A zero or negative stored factor is refused rather than dividing by it")
    void degenerateStockFactorIsEmpty() {
        Optional<BigDecimal> f = IngredientUomFactorResolver.factorToIngredientBase(
                KG, "BAD", uom("BAD", "G", "0"));
        assertThat(f).isEmpty();
    }
}
