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
     *
     * <p>{@code *AccountName} is the account's name from finance-service, so a category renders as
     * "1400 · Food Inventory" rather than a bare number nobody can read at a glance. It is
     * BEST-EFFORT and null when finance-service could not be reached — browsing and reorganising
     * categories must keep working while accounting is down, unlike a category SAVE, which fails
     * closed rather than persisting an unverified account.
     *
     * <p>{@code *InheritedFrom} names the ancestor category an inherited value came from, letting
     * the form show "Inherited from Proteins — 1400 · Food Inventory" as a placeholder instead of
     * leaving a manager to work out why an untouched field already has a value.
     */
    public record ResolvedGlAccountsDto(
            String inventoryAccountCode,
            String costAccountCode,
            String wasteAccountCode,
            boolean inventoryInherited,
            boolean costInherited,
            boolean wasteInherited,
            String inventoryAccountName,
            String costAccountName,
            String wasteAccountName,
            String inventoryInheritedFrom,
            String costInheritedFrom,
            String wasteInheritedFrom) {}

    /**
     * One selectable account in the category form's GL picker — the shape
     * {@code GET /api/v1/inventory/gl-accounts} returns.
     *
     * <p>Inventory re-exposes finance's chart of accounts through its own endpoint, narrowed to
     * active accounts of the types the requested slot accepts, so an inventory manager can pick an
     * account WITHOUT holding {@code finance.coa.view} — a permission that would otherwise hand
     * them the whole finance read surface just to fill in three fields.
     */
    public record GlAccountOptionDto(
            UUID id,
            String code,
            String name,
            String accountType) {}
}
