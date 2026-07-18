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
}
