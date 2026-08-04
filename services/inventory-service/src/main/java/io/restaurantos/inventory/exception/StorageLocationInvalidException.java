package io.restaurantos.inventory.exception;

import io.restaurantos.shared.exception.RestaurantOsException;

/**
 * A storage-location write or reference cannot be honoured. Maps to HTTP 422 via
 * {@code InventoryExceptionHandler}, on the same footing as {@link UomInvalidException} and
 * {@link GlAccountInvalidException}: the payload is well-formed, it just names something the
 * tenant does not have or cannot use.
 *
 * <p>The one exception is {@link #inUse}, which is 409 — an archive attempt on a location that
 * still holds live ingredients is a state conflict, not a malformed reference, and it matches
 * what {@code CategoryInUseException} already answers for the identical situation on categories.
 */
public class StorageLocationInvalidException extends RestaurantOsException {

    private StorageLocationInvalidException(String code, String message) {
        super(code, message);
    }

    /** The location is archived, so it can no longer be assigned to an ingredient. */
    public static StorageLocationInvalidException archived(String name) {
        return new StorageLocationInvalidException("STORAGE_LOCATION_ARCHIVED",
                "Can't file items in \"" + name + "\" — this storage location is archived.");
    }

    /** Mirrors {@code uq_storage_location_tenant_name_ci}: two casings of one shelf are one shelf. */
    public static StorageLocationInvalidException duplicate(String name) {
        return new StorageLocationInvalidException("STORAGE_LOCATION_DUPLICATE",
                "A storage location named \"" + name + "\" already exists.");
    }

    public static StorageLocationInvalidException inUse(String name, long ingredientCount) {
        return new StorageLocationInvalidException("STORAGE_LOCATION_IN_USE",
                "Can't archive \"" + name + "\" — " + ingredientCount
                        + (ingredientCount == 1 ? " item is" : " items are")
                        + " still stored there. Move them first.");
    }
}
