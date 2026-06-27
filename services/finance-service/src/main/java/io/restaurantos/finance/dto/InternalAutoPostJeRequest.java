package io.restaurantos.finance.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** Request body for POST /internal/finance/journal-entries (auto-post). */
public record InternalAutoPostJeRequest(
        @NotNull UUID branchId,
        @NotNull LocalDate entryDate,
        String description,
        @NotNull String sourceType,
        @NotNull UUID sourceId,
        @NotEmpty @Valid List<CreateJeLineRequest> lines
) {}
