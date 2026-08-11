package io.restaurantos.pos.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Request DTOs for the dining-table catalogue write path (19b-01). Mirrors
 * {@link MenuItemAdminDtos}' validated-record style.
 *
 * <p>Create and update carry the same fields and are still two records rather than one: the
 * pair is what makes "you cannot change which branch a table is in" expressible — branch is
 * taken from the caller's verified JWT on create and is simply absent from update, so there
 * is no shape in which a client can move a table between branches.
 */
public class TableAdminDtos {

    /**
     * {@code capacity} is bounded on BOTH ends. The lower bound is obvious; the upper bound
     * (100) exists because capacity feeds cover counts and therefore per-head reporting, and a
     * fat-fingered 400 silently distorts every average-spend figure for the period rather than
     * failing visibly.
     */
    public record CreateDiningTableRequest(
            @NotBlank @Size(max = 20) String tableNumber,
            @NotNull @Min(1) @Max(100) Integer capacity,
            @Size(max = 50) String section
    ) {}

    public record UpdateDiningTableRequest(
            @NotBlank @Size(max = 20) String tableNumber,
            @NotNull @Min(1) @Max(100) Integer capacity,
            @Size(max = 50) String section
    ) {}

    private TableAdminDtos() {}
}
