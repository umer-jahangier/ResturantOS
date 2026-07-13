package io.restaurantos.pos.dto;

import io.restaurantos.pos.domain.enums.TableStatus;
import io.restaurantos.pos.domain.model.DiningTable;

import java.math.BigDecimal;
import java.util.UUID;

public record DiningTableDto(
        UUID id,
        UUID branchId,
        String tableName,
        int capacity,
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
                table.getStatus(),
                table.getFloorPlanX(),
                table.getFloorPlanY(),
                table.getFloorPlanShape()
        );
    }
}
