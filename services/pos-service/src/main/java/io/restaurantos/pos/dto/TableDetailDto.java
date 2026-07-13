package io.restaurantos.pos.dto;

import io.restaurantos.pos.domain.enums.DerivedOrderStatus;
import io.restaurantos.pos.domain.enums.TableStatus;
import io.restaurantos.pos.domain.model.DiningTable;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Table-centric dine-in detail (POS-10): {@link DiningTableDto} fields + the table's active
 * (non-terminal) order, if any, + a live bill summary. Follows the same record + static
 * {@code from(...)} factory shape as {@link DiningTableDto}.
 */
public record TableDetailDto(
        UUID id,
        UUID branchId,
        String tableName,
        int capacity,
        TableStatus status,
        BigDecimal floorPlanX,
        BigDecimal floorPlanY,
        String floorPlanShape,
        OrderDto activeOrder,
        DerivedOrderStatus derivedStatus,
        UUID cashierId,
        long subtotalPaisa,
        long discountPaisa,
        long taxPaisa,
        long totalPaisa
) {
    public static TableDetailDto from(DiningTable table, OrderDto activeOrder) {
        return new TableDetailDto(
                table.getId(),
                table.getBranchId(),
                table.getTableNumber(),
                table.getCapacity(),
                table.getStatus(),
                table.getFloorPlanX(),
                table.getFloorPlanY(),
                table.getFloorPlanShape(),
                activeOrder,
                activeOrder != null ? activeOrder.derivedStatus() : null,
                activeOrder != null ? activeOrder.cashierId() : null,
                activeOrder != null ? activeOrder.subtotalPaisa() : 0L,
                activeOrder != null ? activeOrder.discountPaisa() : 0L,
                activeOrder != null ? activeOrder.taxPaisa() : 0L,
                activeOrder != null ? activeOrder.totalPaisa() : 0L
        );
    }
}
