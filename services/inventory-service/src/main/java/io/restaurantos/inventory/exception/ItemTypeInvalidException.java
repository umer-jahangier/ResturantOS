package io.restaurantos.inventory.exception;

import io.restaurantos.shared.exception.RestaurantOsException;

/**
 * The ingredient's {@code itemType} and its {@code producedByRecipeId} disagree. Maps to HTTP 422
 * via {@code InventoryExceptionHandler}, same footing as {@link UomInvalidException}.
 *
 * <p>Until this existed, {@code PREPARED} and {@code BOTH} were dead options on the ingredient
 * form: both were accepted, neither was validated, and {@code producedByRecipeId} was never
 * populated by any caller — so an item marked "Prepared" was indistinguishable from a purchased
 * one everywhere downstream.
 *
 * <p>Note what is deliberately NOT enforced: a {@code PREPARED} item is not REQUIRED to name its
 * recipe. Real authoring order is item first, recipe second — the recipe has to be able to
 * reference the item it produces — so demanding the link up front would make the correct sequence
 * impossible.
 */
public class ItemTypeInvalidException extends RestaurantOsException {

    private ItemTypeInvalidException(String code, String message) {
        super(code, message);
    }

    public static ItemTypeInvalidException unknownItemType(String itemType) {
        return new ItemTypeInvalidException("ITEM_TYPE_INVALID",
                "Item type must be PURCHASED, PREPARED or BOTH — got \"" + itemType + "\".");
    }

    /** A purchased item cannot be produced by a recipe; that is what makes it purchased. */
    public static ItemTypeInvalidException recipeOnPurchasedItem() {
        return new ItemTypeInvalidException("ITEM_TYPE_RECIPE_NOT_ALLOWED",
                "Only a prepared item can name the recipe that produces it. "
                        + "Set the item type to Prepared or Both, or clear the recipe.");
    }
}
