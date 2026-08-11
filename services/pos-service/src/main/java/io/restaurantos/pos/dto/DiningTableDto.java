package io.restaurantos.pos.dto;

import io.restaurantos.pos.domain.enums.TableStatus;
import io.restaurantos.pos.domain.model.DiningTable;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * {@code status} is RUNTIME state (is someone sitting here right now) and {@code active} is
 * CATALOGUE state (does this table exist in this restaurant at all). Both are on the wire
 * because the two screens that read this DTO need different ones: the order-taking picker
 * filters on {@code status}, the management table shows {@code active}.
 */
public record DiningTableDto(
        UUID id,
        UUID branchId,
        String tableName,
        int capacity,
        String section,
        boolean active,
        TableStatus status,
        BigDecimal floorPlanX,
        BigDecimal floorPlanY,
        String floorPlanShape
) {
    public static DiningTableDto from(DiningTable table) {
        return new DiningTableDto(
                table.getId(),
                table.getBranchId(),
                table.getTableNumber(),
                table.getCapacity(),
                table.getSection(),
                table.isActive(),
                table.getStatus(),
                table.getFloorPlanX(),
                table.getFloorPlanY(),
                table.getFloorPlanShape()
        );
    }
}
