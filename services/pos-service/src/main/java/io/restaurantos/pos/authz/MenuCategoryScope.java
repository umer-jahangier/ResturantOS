package io.restaurantos.pos.authz;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;

/**
 * What menu categories a caller may see on the till grid (Program A).
 *
 * <h2>This is a FILTER. The boundary is elsewhere, and that distinction is the whole design</h2>
 *
 * <p>This type decides what to DRAW. {@code pos.rego}'s {@code pos.order.add_item} rules, reached
 * through {@code PosAuthorizationService.authorizeAddItem}, decide what may be RUNG — and they hold
 * for a caller who never opened the grid, which is exactly why the owner said hiding the tile was
 * not enough. Deleting this class would make a confined cashier see buttons that 403; deleting the
 * OPA call would remove the boundary entirely. They are not two implementations of one control.
 *
 * <p>V15's header drew the same line before either existed, and this is the shape it asked for:
 * "THE CATEGORY SCOPE IS A FILTER, NOT AN AUTHORIZATION BOUNDARY... If a hard boundary is ever
 * wanted, it belongs in the policy engine with its own rules and its own tests."
 *
 * <h2>Every degenerate input degrades OPEN — and here that is safe</h2>
 *
 * <p>Absent claim, JSON null, empty list, wrong type, unparseable entry: all of them produce
 * {@link #unrestricted()}. Reading any of them as "permitted: nothing" would show a cashier an empty
 * menu mid-service, which looks exactly like a product that has lost its catalogue.
 *
 * <p>This is the same deliberate inversion {@code StationScope} documents in kitchen-service, and it
 * is SAFE here for a reason that is worth stating plainly, because a later reader "hardening" it
 * would be making a locally reasonable change that costs a restaurant its service: a degraded filter
 * shows too many buttons, and every one of those buttons still has to pass the OPA boundary before
 * an item lands on a check. The filter failing open cannot widen what anyone may sell. The boundary
 * fails CLOSED, separately, and that is where the security lives.
 *
 * <p>{@link #unrestricted()} is a distinct state with no accessor that hands out an empty
 * collection, so the wrong reading is not available to make.
 */
public final class MenuCategoryScope {

    private static final MenuCategoryScope UNRESTRICTED = new MenuCategoryScope(null);

    /** Null means unrestricted. Never exposed; see the class javadoc for why. */
    private final Set<UUID> permitted;

    private MenuCategoryScope(Set<UUID> permitted) {
        this.permitted = permitted;
    }

    /** May ring the whole menu — the state every existing user is in. */
    public static MenuCategoryScope unrestricted() {
        return UNRESTRICTED;
    }

    /**
     * Restricted to exactly these category ids.
     *
     * <p>An empty collection returns {@link #unrestricted()} rather than a scope permitting nothing.
     * There is no legitimate meaning for "assigned to zero categories" that differs from "not
     * assigned", and allowing the two to be distinct is how one of them eventually gets treated as
     * an empty allow-list. {@code pos.rego} makes the identical promise from the policy side.
     */
    public static MenuCategoryScope restrictedTo(Collection<UUID> categoryIds) {
        if (categoryIds == null || categoryIds.isEmpty()) {
            return UNRESTRICTED;
        }
        Set<UUID> normalised = new LinkedHashSet<>();
        for (UUID id : categoryIds) {
            if (id != null) {
                normalised.add(id);
            }
        }
        return normalised.isEmpty() ? UNRESTRICTED : new MenuCategoryScope(Set.copyOf(normalised));
    }

    /**
     * The INTERSECTION of this scope and another, each empty meaning everything.
     *
     * <p>Exists so a device-level narrowing (a terminal's configured category list) can be applied
     * on top of the person's own scope without either one being able to WIDEN the other. Two
     * unrestricted scopes intersect to unrestricted; an unrestricted one intersected with a
     * restricted one is that restricted one; two restricted ones give only what both permit — which
     * may legitimately be nothing, and that is the one case where an empty result is meaningful
     * rather than degenerate, because both sides deliberately said something.
     */
    public MenuCategoryScope intersect(MenuCategoryScope other) {
        if (other == null || other.isUnrestricted()) {
            return this;
        }
        if (isUnrestricted()) {
            return other;
        }
        Set<UUID> both = new LinkedHashSet<>(permitted);
        both.retainAll(other.permitted);
        // Deliberately NOT collapsing an empty intersection to unrestricted. Both sides named
        // categories and they do not overlap; showing the whole menu there would be inventing
        // permission neither one granted.
        return new MenuCategoryScope(Set.copyOf(both));
    }

    /** True when this caller sees the whole menu. */
    public boolean isUnrestricted() {
        return permitted == null;
    }

    /** May this caller see and ring this category? Always true for an unrestricted scope. */
    public boolean permits(UUID categoryId) {
        if (permitted == null) {
            return true;
        }
        return categoryId != null && permitted.contains(categoryId);
    }

    /**
     * The permitted ids, for building a query predicate.
     *
     * <p>Throws for an unrestricted scope rather than returning an empty set — a caller that reaches
     * here without checking {@link #isUnrestricted()} first is about to build a query with an empty
     * {@code IN} clause, and this is the loud version of that mistake.
     */
    public Set<UUID> permittedCategoryIds() {
        if (permitted == null) {
            throw new IllegalStateException(
                "An unrestricted scope has no id list. Check isUnrestricted() first — asking for "
                    + "the ids here means a query is about to be built with an empty IN clause, "
                    + "which returns no items and empties the till grid.");
        }
        return permitted;
    }

    @Override
    public String toString() {
        return permitted == null ? "MenuCategoryScope[unrestricted]" : "MenuCategoryScope" + permitted;
    }
}
