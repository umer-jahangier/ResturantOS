package io.restaurantos.inventory.exception;

import io.restaurantos.shared.exception.RestaurantOsException;

/**
 * A create or rename would collide with a sibling category of the same name under the same
 * parent (or another root, for a top-level category) — the same conflict {@code
 * uq_item_category_tenant_parent_name} enforces at the database layer. Maps to HTTP 409 via
 * {@code InventoryExceptionHandler}, on the same footing as {@link CategoryInUseException} and
 * {@link StorageLocationInvalidException#duplicate}: a well-formed request that collides with an
 * existing row, not a malformed one.
 *
 * <p>Exists so this collision surfaces as a name the manager can fix, instead of the unhandled
 * {@code DataIntegrityViolationException} the constraint alone produces — which
 * {@code GlobalExceptionHandler} has no choice but to answer with a bare 500, and which the
 * gateway's {@code CircuitBreaker} filter then rewrites into "service temporarily unavailable" for
 * every route it fronts. Neither layer had anything specific to say; this makes sure one of them
 * does before the request ever reaches either.
 */
public class CategoryNameDuplicateException extends RestaurantOsException {

    public CategoryNameDuplicateException(String name, String parentName, boolean conflictIsArchived) {
        super("CATEGORY_NAME_DUPLICATE", buildMessage(name, parentName, conflictIsArchived));
    }

    private static String buildMessage(String name, String parentName, boolean conflictIsArchived) {
        String base = parentName == null
                ? "A top-level category named \"" + name + "\" already exists"
                : "\"" + parentName + "\" already has a subcategory named \"" + name + "\"";
        if (!conflictIsArchived) {
            return base + ".";
        }
        // The default category list hides archived rows, so without this qualifier the manager is
        // told a name is taken while looking at a screen that provably does not show it — the
        // exact confusion this clause exists to head off. "Restore" is the actual next step,
        // matching how CategoryTree already renders an archived row's own menu.
        return base + ", but it's archived. Restore it, or use a different name.";
    }
}
