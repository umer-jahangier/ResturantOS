package io.restaurantos.inventory.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.UUID;

/** Request/response records for tenant-managed storage locations (V10). */
public final class StorageLocationDtos {

    private StorageLocationDtos() {}

    public record CreateStorageLocationRequest(
            @NotBlank @Size(max = 80) String name,
            @Size(max = 255) String description,
            Integer sortOrder) {}

    public record UpdateStorageLocationRequest(
            @NotBlank @Size(max = 80) String name,
            @Size(max = 255) String description,
            Integer sortOrder) {}

    /**
     * {@code ingredientCount} is the number of LIVE ingredients filed here — the same number the
     * archive gate checks, surfaced on the row so a manager can see why archiving will be refused
     * before they try it rather than after.
     */
    public record StorageLocationDto(
            UUID id,
            String name,
            String description,
            int sortOrder,
            long ingredientCount,
            Instant archivedAt) {}
}
