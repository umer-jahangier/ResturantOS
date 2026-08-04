package io.restaurantos.inventory.exception;

import io.restaurantos.shared.exception.RestaurantOsException;

import java.util.UUID;

/**
 * Thrown by {@code ItemCategoryService.archive} when the category still has at least one
 * non-archived child category or one ingredient assigned to it (D-04 archive-refusal). Maps to
 * HTTP 409 {@code CATEGORY_IN_USE} via {@code InventoryExceptionHandler}. The message matches
 * 08.2-UI-SPEC.md's Copywriting Contract archive-refused string verbatim
 * ("Can't archive — {N} ingredient(s) still use this category. Reassign them, then try again.")
 * when ingredients are the blocker — the case the archive dialog renders inline.
 */
public class CategoryInUseException extends RestaurantOsException {

    private final UUID categoryId;
    private final long ingredientCount;
    private final long childCount;

    public CategoryInUseException(UUID categoryId, long ingredientCount, long childCount) {
        super("CATEGORY_IN_USE", buildMessage(ingredientCount, childCount));
        this.categoryId = categoryId;
        this.ingredientCount = ingredientCount;
        this.childCount = childCount;
    }

    private static String buildMessage(long ingredientCount, long childCount) {
        if (ingredientCount > 0) {
            return "Can't archive — " + ingredientCount
                    + " ingredient(s) still use this category. Reassign them, then try again.";
        }
        return "Can't archive — " + childCount
                + " subcategory(ies) still exist under this category. Archive or move them first.";
    }

    public UUID getCategoryId() {
        return categoryId;
    }

    public long getIngredientCount() {
        return ingredientCount;
    }

    public long getChildCount() {
        return childCount;
    }
}
