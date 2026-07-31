package io.restaurantos.pos.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record ReviewTillNoteRequest(
        @NotBlank @Size(max = 500) String note
) {}
