package io.restaurantos.inventory.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Request/response records for stock wastage (INV-06 / FIN-03's WASTAGE recipe). {@code tenantId}
 * is intentionally absent — resolved from TenantContext/JWT only, mirroring every other write DTO
 * in this service.
 */
public final class WastageDtos {

    private WastageDtos() {}

    public record RecordWastageRequest(
            @NotNull UUID branchId,
            @NotBlank String reason,
            @Size(max = 500) String notes,
            @NotEmpty @Valid List<WastageLineRequest> lines) {}

    /** {@code qty} is what is being written OFF, so it is always positive; the movement is signed. */
    public record WastageLineRequest(
            @NotNull UUID ingredientId,
            @NotNull @Positive BigDecimal qty) {}

    public record WastageDto(
            UUID wastageId,
            UUID branchId,
            String reason,
            String notes,
            Instant recordedAt,
            List<WastageLineDto> lines,
            long totalCostPaisa) {}

    public record WastageLineDto(
            UUID ingredientId,
            BigDecimal qty,
            long unitCostPaisa,
            long lineCostPaisa) {}
}
