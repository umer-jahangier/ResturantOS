package io.restaurantos.purchasing.service;

import io.restaurantos.purchasing.domain.model.VendorItemPrice;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * A branch's own vendor price has to be the price that branch sees.
 *
 * <p>It was not. {@code VendorItemService}, {@code PurchaseOrderService},
 * {@code OrderSuggestionService} and {@code VendorItemPriceService} each carried their own
 * {@code .filter(p -> p.getBranchId() == null)}, so a price recorded through the dialog's "This
 * branch only" option was written, listed in Price Changes, and then ignored by every screen that
 * shows or uses a price. On the live database one catalog row's ONLY price was branch-scoped: its
 * Current price column read "—", and a PO line for it was refused with "no current catalog price".
 */
class CurrentPriceResolverTest {

    private static final UUID ITEM = UUID.randomUUID();
    private static final UUID BRANCH = UUID.randomUUID();
    private static final UUID OTHER_BRANCH = UUID.randomUUID();

    private static VendorItemPrice price(UUID branchId, long paisa, String effectiveFrom) {
        VendorItemPrice p = new VendorItemPrice();
        p.setVendorItemId(ITEM);
        p.setBranchId(branchId);
        p.setUnitPricePaisa(paisa);
        p.setPriceUom("KG");
        p.setEffectiveFrom(Instant.parse(effectiveFrom));
        return p;
    }

    @Test
    void aBranchPriceWinsForThatBranch() {
        List<VendorItemPrice> rows = List.of(
                price(BRANCH, 71_000L, "2026-07-30T00:00:00Z"),
                price(null, 62_000L, "2026-07-01T00:00:00Z"));

        assertThat(CurrentPriceResolver.byVendorItem(rows, BRANCH).get(ITEM).getUnitPricePaisa())
                .isEqualTo(71_000L);
    }

    /** Order is by effectiveFrom DESC, so a NEWER tenant-wide row must still lose to the branch's. */
    @Test
    void aBranchPriceWinsEvenWhenTheTenantWidePriceIsNewer() {
        List<VendorItemPrice> rows = List.of(
                price(null, 62_000L, "2026-07-30T00:00:00Z"),
                price(BRANCH, 71_000L, "2026-07-01T00:00:00Z"));

        assertThat(CurrentPriceResolver.byVendorItem(rows, BRANCH).get(ITEM).getUnitPricePaisa())
                .as("scope decides, not recency — a branch deal is not superseded by a list price")
                .isEqualTo(71_000L);
    }

    @Test
    void theTenantWidePriceIsTheFallback() {
        List<VendorItemPrice> rows = List.of(price(null, 62_000L, "2026-07-01T00:00:00Z"));

        assertThat(CurrentPriceResolver.byVendorItem(rows, BRANCH).get(ITEM).getUnitPricePaisa())
                .isEqualTo(62_000L);
    }

    /** The live row that had no visible price at all: branch-scoped, and the only one there is. */
    @Test
    void aBranchOnlyPriceIsVisibleToItsBranch() {
        List<VendorItemPrice> rows = List.of(price(BRANCH, 95_000L, "2026-07-30T00:00:00Z"));

        assertThat(CurrentPriceResolver.byVendorItem(rows, BRANCH).get(ITEM))
                .as("a priced catalog row must never show as unpriced to the branch it was priced for")
                .isNotNull();
    }

    @Test
    void anotherBranchesPriceIsNeverBorrowed() {
        List<VendorItemPrice> rows = List.of(price(OTHER_BRANCH, 95_000L, "2026-07-30T00:00:00Z"));

        assertThat(CurrentPriceResolver.byVendorItem(rows, BRANCH))
                .as("showing one branch a price negotiated for another is worse than showing none")
                .isEmpty();
    }

    /** Callers with no branch context (tenant-level reads) still get exactly the old answer. */
    @Test
    void withNoBranchOnlyTheTenantWidePriceResolves() {
        List<VendorItemPrice> rows = List.of(
                price(BRANCH, 71_000L, "2026-07-30T00:00:00Z"),
                price(null, 62_000L, "2026-07-01T00:00:00Z"));

        assertThat(CurrentPriceResolver.byVendorItem(rows, null).get(ITEM).getUnitPricePaisa())
                .isEqualTo(62_000L);
    }

    @Test
    void theNewestOpenRowOfTheWinningScopeIsTaken() {
        // As the repository returns them: effectiveFrom DESC.
        List<VendorItemPrice> rows = List.of(
                price(null, 62_000L, "2026-07-30T00:00:00Z"),
                price(null, 50_000L, "2026-07-01T00:00:00Z"));

        assertThat(CurrentPriceResolver.byVendorItem(rows, null).get(ITEM).getUnitPricePaisa())
                .isEqualTo(62_000L);
    }
}
