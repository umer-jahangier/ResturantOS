package io.restaurantos.inventory.service;

import io.restaurantos.inventory.domain.model.StorageLocation;
import io.restaurantos.inventory.dto.StorageLocationDtos.CreateStorageLocationRequest;
import io.restaurantos.inventory.dto.StorageLocationDtos.StorageLocationDto;
import io.restaurantos.inventory.dto.StorageLocationDtos.UpdateStorageLocationRequest;
import io.restaurantos.inventory.exception.StorageLocationInvalidException;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.StorageLocationRepository;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Tenant-managed storage locations (V10) — the master-data replacement for
 * {@code ingredients.storage_location}'s free text.
 *
 * <p>Deliberately thin compared to {@link ItemCategoryService}: locations are flat, so there is no
 * tree walk, no depth cap and no inheritance to resolve. What it does share is the D-04 archive
 * convention — {@link #archive} refuses while live ingredients still point here, exactly as
 * {@code ItemCategoryService.archive} does, because silently detaching stock from its shelf is
 * worse than making someone move it first.
 */
@Service
@Transactional(readOnly = true)
public class StorageLocationService {

    private final StorageLocationRepository storageLocationRepository;
    private final IngredientRepository ingredientRepository;
    private final TenantContext tenantContext;

    public StorageLocationService(StorageLocationRepository storageLocationRepository,
                                   IngredientRepository ingredientRepository,
                                   TenantContext tenantContext) {
        this.storageLocationRepository = storageLocationRepository;
        this.ingredientRepository = ingredientRepository;
        this.tenantContext = tenantContext;
    }

    public List<StorageLocationDto> list(boolean includeArchived) {
        UUID tenantId = tenantContext.requireTenantId();
        Map<UUID, Long> counts = ingredientCounts(tenantId);
        List<StorageLocationDto> result = new ArrayList<>();
        for (StorageLocation location : storageLocationRepository.findByTenantIdOrderBySortOrderAscNameAsc(tenantId)) {
            if (!includeArchived && location.getArchivedAt() != null) {
                continue;
            }
            result.add(toDto(location, counts.getOrDefault(location.getId(), 0L)));
        }
        return result;
    }

    @Transactional
    public StorageLocationDto create(CreateStorageLocationRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        String name = requireName(request.name());
        requireNameAvailable(tenantId, name, null);

        StorageLocation location = new StorageLocation();
        location.setTenantId(tenantId);
        location.setName(name);
        location.setDescription(trimToNull(request.description()));
        location.setSortOrder(request.sortOrder() != null ? request.sortOrder() : 0);
        return toDto(storageLocationRepository.save(location), 0L);
    }

    @Transactional
    public StorageLocationDto update(UUID id, UpdateStorageLocationRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        StorageLocation location = require(tenantId, id);
        String name = requireName(request.name());
        requireNameAvailable(tenantId, name, id);

        location.setName(name);
        location.setDescription(trimToNull(request.description()));
        if (request.sortOrder() != null) {
            location.setSortOrder(request.sortOrder());
        }
        StorageLocation saved = storageLocationRepository.save(location);
        return toDto(saved, ingredientCounts(tenantId).getOrDefault(id, 0L));
    }

    /**
     * D-04: archive, never delete — and refuse while live ingredients still reference this
     * location. The FK V10 adds is {@code ON DELETE RESTRICT}, so a delete would fail at the
     * database anyway; refusing here turns that constraint violation into a sentence naming how
     * many items are in the way.
     */
    @Transactional
    public StorageLocationDto archive(UUID id) {
        UUID tenantId = tenantContext.requireTenantId();
        StorageLocation location = require(tenantId, id);
        long inUse = ingredientRepository
                .countByTenantIdAndStorageLocationIdAndArchivedAtIsNull(tenantId, id);
        if (inUse > 0) {
            throw StorageLocationInvalidException.inUse(location.getName(), inUse);
        }
        location.setArchivedAt(Instant.now());
        return toDto(storageLocationRepository.save(location), 0L);
    }

    @Transactional
    public StorageLocationDto restore(UUID id) {
        UUID tenantId = tenantContext.requireTenantId();
        StorageLocation location = require(tenantId, id);
        location.setArchivedAt(null);
        StorageLocation saved = storageLocationRepository.save(location);
        return toDto(saved, ingredientCounts(tenantId).getOrDefault(id, 0L));
    }

    /**
     * Resolves the location an ingredient write is filing itself under, returning {@code null} when
     * none was requested. Called from inside {@code IngredientService}'s write transaction, which is
     * why it takes an explicit tenant id rather than reading {@link TenantContext} again.
     *
     * @throws ResourceNotFoundException          the id is unknown, or belongs to another tenant
     * @throws StorageLocationInvalidException    the location exists but is archived
     */
    public StorageLocation resolveAssignable(UUID tenantId, UUID storageLocationId) {
        if (storageLocationId == null) {
            return null;
        }
        StorageLocation location = require(tenantId, storageLocationId);
        if (location.getArchivedAt() != null) {
            throw StorageLocationInvalidException.archived(location.getName());
        }
        return location;
    }

    // ---- helpers ----

    private StorageLocation require(UUID tenantId, UUID id) {
        return storageLocationRepository.findByTenantIdAndId(tenantId, id)
                .orElseThrow(() -> new ResourceNotFoundException("StorageLocation", id));
    }

    /**
     * Case-insensitive, matching {@code uq_storage_location_tenant_name_ci}. Doing it here rather
     * than letting the index reject the insert is what turns a constraint-violation 500 into a
     * message naming the location that already exists.
     */
    private void requireNameAvailable(UUID tenantId, String name, UUID selfId) {
        storageLocationRepository.findByTenantIdAndNameIgnoreCase(tenantId, name)
                .filter(existing -> !existing.getId().equals(selfId))
                .ifPresent(existing -> {
                    throw StorageLocationInvalidException.duplicate(existing.getName());
                });
    }

    private Map<UUID, Long> ingredientCounts(UUID tenantId) {
        Map<UUID, Long> counts = new HashMap<>();
        for (Object[] row : ingredientRepository.countByTenantIdGroupedByStorageLocation(tenantId)) {
            counts.put((UUID) row[0], (Long) row[1]);
        }
        return counts;
    }

    /** {@code @NotBlank} on the request already rejects an empty name before it reaches here; this
     * is only about storing the TRIMMED form, so " Freezer " and "Freezer" cannot coexist. */
    private static String requireName(String name) {
        String trimmed = trimToNull(name);
        if (trimmed == null) {
            throw new IllegalArgumentException("Storage location name is required");
        }
        return trimmed;
    }

    private static String trimToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static StorageLocationDto toDto(StorageLocation location, long ingredientCount) {
        return new StorageLocationDto(
                location.getId(),
                location.getName(),
                location.getDescription(),
                location.getSortOrder(),
                ingredientCount,
                location.getArchivedAt());
    }
}
