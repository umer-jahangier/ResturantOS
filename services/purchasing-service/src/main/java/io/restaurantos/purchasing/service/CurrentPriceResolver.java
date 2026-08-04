package io.restaurantos.purchasing.service;

import io.restaurantos.purchasing.domain.model.VendorItemPrice;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Which of a vendor item's open price rows is "the current price" for a given branch.
 *
 * <p><b>Why this exists.</b> {@code vendor_item_prices.branch_id} lets a price apply to one branch
 * instead of the whole tenant, and the price dialog offers exactly that choice ("This branch only"
 * / "All branches"). Every reader then discarded it: {@code VendorItemService},
 * {@code PurchaseOrderService}, {@code OrderSuggestionService} and {@code VendorItemPriceService}
 * each carried their own copy of {@code .filter(p -> p.getBranchId() == null)}. A branch price was
 * saved, appeared in the Price Changes report, and was invisible everywhere it mattered — the
 * catalog's Current price column showed "—", a PO line derived no price at all, and order
 * suggestions estimated nothing. On the live database one vendor item's ONLY price was branch
 * -scoped, so that catalog row had no current price despite having been priced.
 *
 * <p>Those four filters were not an oversight — an earlier review (08.2 WR-05) added them
 * deliberately, because {@code findCurrentForVendorItems} returns tenant-wide and branch rows
 * together and a bare {@code findFirst()} made the four readers disagree about the price of the
 * same item in money-bearing paths. Agreeing on the WRONG answer fixed the disagreement and kept
 * the defect. This resolver keeps them agreeing on the right one: <b>a branch's own price wins for
 * that branch; the tenant-wide price is the fallback.</b> With no branch price recorded, the answer
 * is identical to what all four returned before.
 *
 * <p>Rows must arrive ordered by {@code effectiveFrom} descending — which
 * {@code VendorItemPriceRepository.findCurrentForVendorItems} guarantees — so the newest open row
 * of the winning scope is the one taken.
 */
final class CurrentPriceResolver {

    private CurrentPriceResolver() {}

    /**
     * @param currentRows open price rows for any number of vendor items, newest first
     * @param branchId    the branch being priced for; null asks for the tenant-wide price only
     */
    static Map<UUID, VendorItemPrice> byVendorItem(List<VendorItemPrice> currentRows, UUID branchId) {
        Map<UUID, VendorItemPrice> branchScoped = new HashMap<>();
        Map<UUID, VendorItemPrice> tenantWide = new HashMap<>();
        for (VendorItemPrice price : currentRows) {
            if (price.getBranchId() == null) {
                tenantWide.putIfAbsent(price.getVendorItemId(), price);
            } else if (price.getBranchId().equals(branchId)) {
                branchScoped.putIfAbsent(price.getVendorItemId(), price);
            }
            // A price scoped to a DIFFERENT branch is not this branch's price and is never a
            // fallback for it — that would be worse than showing nothing.
        }
        Map<UUID, VendorItemPrice> resolved = new HashMap<>(tenantWide);
        resolved.putAll(branchScoped);
        return resolved;
    }

    /** Single-item variant, same rule. */
    static Optional<VendorItemPrice> resolve(List<VendorItemPrice> currentRows, UUID vendorItemId, UUID branchId) {
        return Optional.ofNullable(byVendorItem(currentRows, branchId).get(vendorItemId));
    }
}
