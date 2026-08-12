package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.domain.model.TaxClass;
import io.restaurantos.pos.repository.TaxClassRepository;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * The ONE place that decides what tax a menu item actually carries (F16).
 *
 * <h2>Resolution order</h2>
 *
 * <ol>
 *   <li><b>The item's own tax class.</b> The exception on one dish; the most specific answer wins.
 *       A retired (inactive) class still applies to the items already pointing at it — retiring a
 *       rate must not silently zero-rate a menu, it must stop the rate being CHOSEN again.</li>
 *   <li><b>The category's tax class.</b> "Everything in Mains is standard-rated" — the rule, and
 *       the reason an item added to the category tomorrow is taxed correctly without anyone
 *       touching it.</li>
 *   <li><b>The item's own {@code taxRatePct}/{@code taxRateCode} columns.</b> The custom rate of
 *       an item that belongs to no class. This is EVERY row of EVERY tenant on the day F16 ships,
 *       which is why it stays rather than being migrated: their bills compute the identical figure
 *       tomorrow that they computed yesterday.</li>
 *   <li><b>Zero.</b> Genuinely zero-rated, and labelled as such rather than as an error.</li>
 * </ol>
 *
 * <h2>Why a resolver and not a column</h2>
 *
 * <p>Because "apply the class to the category" has to mean INHERIT, not BULK-WRITE. A bulk write
 * looks identical the day it runs and diverges the first time somebody adds a dish: the new item
 * silently carries nothing, which is exactly the shape of the defect this closes — a Rs 1,657.00
 * check taxed 1.5% because only two of its lines had ever been given a rate.
 *
 * <p>Deliberately mirrors {@link StationRoutingResolver}: same rule/exception shape, same
 * standalone-service reason. A resolution order that can only be exercised through {@code addItem}
 * is one whose edge cases get asserted through six layers of setup, which is how they stop being
 * asserted.
 */
@Service
public class TaxClassResolver {

    private final TaxClassRepository taxClasses;

    public TaxClassResolver(TaxClassRepository taxClasses) {
        this.taxClasses = taxClasses;
    }

    /**
     * What this item is taxed at, and where that answer came from.
     *
     * <p>Never null and never throws. An item whose class id points at a row that has since been
     * hard-deleted falls through to the next step rather than failing a sale — a till that cannot
     * ring a dish because of a configuration reference is worse than a till that rings it at the
     * rate the item itself carries.
     */
    public ResolvedTax resolve(UUID tenantId, MenuItem item) {
        if (item == null) {
            return ResolvedTax.none();
        }

        // 1 — the item's own class.
        if (item.getTaxClassId() != null) {
            TaxClass own = load(tenantId, item.getTaxClassId());
            if (own != null) {
                return ResolvedTax.fromClass(own, TaxSource.ITEM);
            }
        }

        // 2 — the category's class. Read from the already-loaded association: every caller here
        // has the item in a persistence context and the category is on the same aggregate.
        MenuCategory category = item.getCategory();
        if (category != null && category.getTaxClassId() != null) {
            TaxClass inherited = load(tenantId, category.getTaxClassId());
            if (inherited != null) {
                return ResolvedTax.fromClass(inherited, TaxSource.CATEGORY);
            }
        }

        // 3 — the item's legacy custom rate. Note the test is on the RATE, not on the code: an
        // item at 16.00% with no code is the single most common row in the live database, and
        // treating a missing code as "no rate" would stop charging tax on it.
        BigDecimal legacyRate = item.getTaxRatePct();
        boolean hasLegacyRate = legacyRate != null && legacyRate.signum() != 0;
        boolean hasLegacyCode = item.getTaxRateCode() != null && !item.getTaxRateCode().isBlank();
        if (hasLegacyRate || hasLegacyCode) {
            return new ResolvedTax(
                    null,
                    legacyRate == null ? BigDecimal.ZERO : legacyRate,
                    item.getTaxRateCode(),
                    // No class means no name to print. The receipt renderer says "Tax" when the
                    // label is null; inventing "Custom rate" here would put a phrase on a guest's
                    // bill that nobody in the building ever typed.
                    null,
                    TaxSource.ITEM_CUSTOM);
        }

        // 4 — genuinely zero-rated.
        return ResolvedTax.none();
    }

    private TaxClass load(UUID tenantId, UUID taxClassId) {
        if (tenantId == null || taxClassId == null) {
            return null;
        }
        return taxClasses.findByIdAndTenantIdAndDeletedAtIsNull(taxClassId, tenantId).orElse(null);
    }

    /** Where an item's rate came from. Rendered as a caption; never a security control. */
    public enum TaxSource {
        /** The item names its own class — an explicit override of the category rule. */
        ITEM,
        /** Inherited from the category. */
        CATEGORY,
        /** The item's own legacy rate/code columns; it belongs to no class. */
        ITEM_CUSTOM,
        /** Nothing resolved: zero-rated. */
        NONE
    }

    /**
     * @param taxClassId the class that answered, or null when the answer came from the item's own
     *                   columns or from nothing
     * @param ratePct    never null; {@code ZERO} when nothing resolved
     * @param rateCode   the fiscal bucket, or null when unclassified
     * @param label      the human name to print on a bill, or null when there is no class
     */
    public record ResolvedTax(UUID taxClassId, BigDecimal ratePct, String rateCode, String label,
                              TaxSource source) {

        static ResolvedTax none() {
            return new ResolvedTax(null, BigDecimal.ZERO, null, null, TaxSource.NONE);
        }

        static ResolvedTax fromClass(TaxClass c, TaxSource source) {
            return new ResolvedTax(
                    c.getId(),
                    c.getRatePct() == null ? BigDecimal.ZERO : c.getRatePct(),
                    c.getCode(),
                    c.getName(),
                    source);
        }
    }
}
