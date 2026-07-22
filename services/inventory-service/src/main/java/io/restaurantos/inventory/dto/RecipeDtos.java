package io.restaurantos.inventory.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Request/response records for versioned recipe/BOM CRUD (INV-02). */
public final class RecipeDtos {

    private RecipeDtos() {}

    /**
     * {@code effectiveFrom} defaults to now() (service-side) when omitted. {@code tenantId} is
     * intentionally absent — resolved from TenantContext/JWT only, never the request body.
     */
    public record CreateRecipeVersionRequest(
            @NotNull UUID menuItemId,
            @NotNull @Positive BigDecimal yieldServings,
            Instant effectiveFrom,
            String name,
            @NotEmpty @Valid List<RecipeLineRequest> lines) {}

    public record RecipeLineRequest(
            @NotNull UUID ingredientId,
            @NotNull @Positive BigDecimal qty,
            @NotBlank String uomCode,
            @PositiveOrZero BigDecimal yieldPct) {}

    public record RecipeDto(
            UUID id,
            UUID menuItemId,
            int version,
            boolean current,
            Instant effectiveFrom,
            BigDecimal yieldServings,
            String name,
            List<RecipeLineDto> lines) {}

    public record RecipeLineDto(
            UUID id,
            UUID ingredientId,
            BigDecimal qty,
            String uomCode,
            BigDecimal yieldPct) {}

    /** INV-11: a single active catalog menu item with no effective recipe as of the report time. */
    public record MissingMenuItemDto(UUID menuItemId, String name) {}

    /**
     * INV-15: the three-state coverage classification for a single active menu item, computed
     * exclusively from {@code effective_from <= now()} — never from
     * {@link io.restaurantos.inventory.domain.model.Recipe#isCurrent()}.
     * {@code COVERED} has at least one version with {@code effectiveFrom <= now}; {@code SCHEDULED}
     * has only future-dated versions ({@code scheduledFrom} is the earliest of them); {@code
     * NO_RECIPE} has no versions at all.
     */
    public enum CoverageState { COVERED, SCHEDULED, NO_RECIPE }

    /**
     * INV-15: per-menu-item coverage detail. {@code scheduledFrom} is non-null only when {@code
     * state == SCHEDULED}, in which case it is the earliest future {@code effectiveFrom} among the
     * item's versions — the instant the item actually becomes covered.
     */
    public record MenuItemCoverageDto(
            UUID menuItemId, String name, CoverageState state, Instant scheduledFrom) {}

    /**
     * INV-11/INV-15 recipe-coverage report: {@code totalActiveMenuItems} is the size of the
     * tenant's active {@code menu_item_catalog} universe; {@code covered}/{@code scheduled}/
     * {@code noRecipe} are the three-state counts. {@code items} is the authoritative three-state
     * list the frontend must consume verbatim (never re-derive coverage state from a boolean).
     * {@code missing} is retained for additive backward compatibility with the pre-08.2-03 shape
     * and now means {@code NO_RECIPE} only — it no longer includes scheduled items.
     */
    public record CoverageResponse(
            int totalActiveMenuItems,
            int covered,
            int scheduled,
            int noRecipe,
            List<MenuItemCoverageDto> items,
            List<MissingMenuItemDto> missing) {}
}
