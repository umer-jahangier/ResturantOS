package io.restaurantos.pos.dto;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * @param taxClassId       the sales-tax class every item in this category inherits, or null when
 *                         the category has no rule (F16)
 * @param taxClassName     that class's human name, so the menu screen can print "Standard rate"
 *                         without a second round trip and without joining two lists in TypeScript
 * @param taxClassRatePct  and its rate, for the same reason
 */
public record MenuCategoryDto(
        UUID id,
        String name,
        String description,
        int sortOrder,
        boolean active,
        UUID taxClassId,
        String taxClassName,
        BigDecimal taxClassRatePct
) {}
