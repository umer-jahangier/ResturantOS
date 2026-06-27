package io.restaurantos.finance.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public record CreateJeRequest(
        @NotNull LocalDate entryDate,
        String description,
        UUID branchId,
        String sourceType,
        UUID sourceId,
        @NotEmpty @Valid List<CreateJeLineRequest> lines
) {}
