package io.restaurantos.inventory.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Request/response records for the item-category tree (INV-13). */
public final class ItemCategoryDtos {

    private ItemCategoryDtos() {}

    /**
     * {@code tenantId} is intentionally absent — resolved from TenantContext/JWT only, never the
     * request body (must_haves.prohibitions #2). No {@code level} field either — the server
     * derives it from the parent's level.
     */
    public record CreateItemCategoryRequest(
            UUID parentId,
            @NotBlank @Size(max = 160) String name,
            @Size(max = 40) String code,
            String defaultInventoryAccountCode,
            String defaultCostAccountCode,
            String defaultWasteAccountCode,
            @PositiveOrZero BigDecimal varianceCapPct,
            Boolean excludeFromPoSuggestions,
            Integer sortOrder) {}

    public record UpdateItemCategoryRequest(
            @NotBlank @Size(max = 160) String name,
            @Size(max = 40) String code,
            String defaultInventoryAccountCode,
            String defaultCostAccountCode,
            String defaultWasteAccountCode,
            @PositiveOrZero BigDecimal varianceCapPct,
            Boolean excludeFromPoSuggestions,
            Integer sortOrder) {}

    /** {@code newParentId} nullable means "make this a root". */
    public record MoveItemCategoryRequest(UUID newParentId) {}

    public record ItemCategoryDto(
            UUID id,
            UUID parentId,
            short level,
            String code,
            String name,
            String defaultInventoryAccountCode,
            String defaultCostAccountCode,
            String defaultWasteAccountCode,
            BigDecimal varianceCapPct,
            boolean excludeFromPoSuggestions,
            int sortOrder,
            Instant archivedAt,
            long ingredientCount,
            ResolvedGlAccountsDto resolvedGlAccounts) {}

    public record ItemCategoryNodeDto(ItemCategoryDto category, List<ItemCategoryNodeDto> children) {}

    /**
     * Most-specific-wins GL account resolution. The {@code *Inherited} booleans drive the UI's
     * "(inherited)" suffix without the browser re-deriving anything.
     */
    public record ResolvedGlAccountsDto(
            String inventoryAccountCode,
            String costAccountCode,
            String wasteAccountCode,
            boolean inventoryInherited,
            boolean costInherited,
            boolean wasteInherited) {}
}
