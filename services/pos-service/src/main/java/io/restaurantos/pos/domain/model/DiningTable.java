package io.restaurantos.pos.domain.model;

import io.restaurantos.pos.domain.enums.TableStatus;
import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.util.UUID;

@Entity
@Table(name = "dining_tables")
@Getter
@Setter
public class DiningTable extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Column(name = "table_number", nullable = false, length = 20)
    private String tableNumber;

    @Column(name = "capacity", nullable = false)
    private int capacity = 4;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 20)
    private TableStatus status = TableStatus.AVAILABLE;

    @Column(name = "floor_plan_x", precision = 8, scale = 2)
    private BigDecimal floorPlanX;

    @Column(name = "floor_plan_y", precision = 8, scale = 2)
    private BigDecimal floorPlanY;

    @Column(name = "floor_plan_shape", length = 20)
    private String floorPlanShape;
}
