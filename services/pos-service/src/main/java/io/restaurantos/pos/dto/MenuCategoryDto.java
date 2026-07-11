package io.restaurantos.pos.dto;

import java.util.UUID;

public record MenuCategoryDto(
        UUID id,
        String name,
        String description,
        int sortOrder,
        boolean active
) {}
