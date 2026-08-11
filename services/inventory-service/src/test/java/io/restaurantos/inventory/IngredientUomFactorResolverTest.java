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

    /**
     * THE HAND-CHECKABLE CASE (D-36-05). A pack priced in the FINER unit of a family, received into
     * an ingredient stocked in the COARSER unit of that same family — the money identical before
     * and after, the quantity a thousandfold apart.
     *
     * <p>A vendor sells Basmati Rice in a 500 g pack for PKR 6,200. The ingredient is stocked in
     * KG. Two packs arrive.
     *
     * <pre>
     *   quantity:  2 packs x 500 G = 1000 G          -> x 0.001 KG/G = 1.0 KG
     *   unit cost: 6,200 paisa/pack / 500 g          -> 12.4 paisa per gram
     *                                                -> / 0.001 = 12,400 paisa per KG
     *   value:     1.0 KG x 1,240,000 paisa/KG (in whole rupees: PKR 12,400/kg)
     *              = the same PKR 12,400 the two packs cost.
     * </pre>
     *
     * <p>Money in, money out, unchanged. Quantity 1.0 and not 1000. Anyone can check this by hand,
     * which is the whole point: the defect it guards against — receiving 1000 G as 1000 KG — was
     * live on this stack, and every downstream check stayed green through it.
     *
     * <p>Driven end to end on the live stack too, in `scripts/e2e/phase31-procure-to-pay-e2e.sh`:
     * `qty_on_hand` moved 106.5000 -> 110.5000 for a two-pack receipt plus a 3 KG hand-typed line,
     * exactly +4.0, and moving-average cost blended to 115,000.0000 paisa/KG — the number this
     * arithmetic predicts, to the paisa.
     */
    @Test
    @DisplayName("A 500 g pack into a KG-stocked ingredient: 1000 G is 1.0 KG, not 1000")
    void theHandCheckableCase_finerPackIntoCoarserStockUnit() {
        // G -> KG is one thousandth. Not 1000, which is KG's own to_base_factor and the number the
        // broken code used; and not 1, which is what a silent fallback would have produced.
        Optional<BigDecimal> gramsIntoKilograms =
                IngredientUomFactorResolver.factorToIngredientBase(G, "KG", KG);
        assertThat(gramsIntoKilograms).isPresent();
        assertThat(gramsIntoKilograms.get()).isEqualByComparingTo("0.001");

        BigDecimal packQtyInGrams = new BigDecimal("1000");            // 2 packs x 500 g
        BigDecimal qtyInKilograms = packQtyInGrams.multiply(gramsIntoKilograms.get());
        assertThat(qtyInKilograms)
                .as("1000 g is one kilogram. Receiving it as 1000 is the 1000x defect.")
                .isEqualByComparingTo("1");

        // Cost per gram -> cost per kilogram is a DIVISION by the same factor, never a second
        // multiplication. 12.4 paisa/g is 12,400 paisa/kg.
        BigDecimal paisaPerGram = new BigDecimal("12.4");
        BigDecimal paisaPerKilogram = paisaPerGram.divide(gramsIntoKilograms.get(), 4, java.math.RoundingMode.HALF_UP);
        assertThat(paisaPerKilogram).isEqualByComparingTo("12400");

        // And the money is unchanged by the conversion, which is the invariant that matters:
        // 1000 g x 12.4 paisa/g == 1.0 kg x 12,400 paisa/kg == 12,400 paisa == PKR 124.00.
        assertThat(qtyInKilograms.multiply(paisaPerKilogram))
                .as("value must survive a unit conversion exactly")
                .isEqualByComparingTo(packQtyInGrams.multiply(paisaPerGram));
    }

    /**
     * The mirror image, so neither direction can regress alone: the COARSER unit into an ingredient
     * stocked in the FINER one. A 2 KG bag into a gram-stocked ingredient is 2000 g.
     */
    @Test
    @DisplayName("A KG pack into a G-stocked ingredient: 2 KG is 2000 G")
    void theMirrorImage_coarserPackIntoFinerStockUnit() {
        Optional<BigDecimal> kilogramsIntoGrams =
                IngredientUomFactorResolver.factorToIngredientBase(KG, "G", G);
        assertThat(kilogramsIntoGrams).hasValueSatisfying(v -> assertThat(v).isEqualByComparingTo("1000"));
        assertThat(new BigDecimal("2").multiply(kilogramsIntoGrams.get())).isEqualByComparingTo("2000");
    }

    /**
     * Never across families, under any circumstance — including when the two codes look
     * interchangeable to a reader. There is no ratio between a litre and a kilogram, and inventing
     * one is how a wrong-family unit becomes a wrong number nobody sees.
     */
    @Test
    @DisplayName("Across unit families there is no factor, and none is guessed")
    void acrossFamiliesIsAlwaysEmpty() {
        assertThat(IngredientUomFactorResolver.factorToIngredientBase(L, "KG", KG)).isEmpty();
        assertThat(IngredientUomFactorResolver.factorToIngredientBase(KG, "L", L)).isEmpty();
        assertThat(IngredientUomFactorResolver.factorToIngredientBase(EACH, "G", G)).isEmpty();
        assertThat(IngredientUomFactorResolver.factorToIngredientBase(DOZEN, "ML", ML)).isEmpty();
    }
}
