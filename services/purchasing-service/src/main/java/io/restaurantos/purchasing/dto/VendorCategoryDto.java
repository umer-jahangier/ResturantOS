package io.restaurantos.purchasing.dto;

import java.util.UUID;

public record VendorCategoryDto(
        UUID categoryId,
        String categoryName,
        boolean preferred
) {}
