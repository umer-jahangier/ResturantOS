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

    /**
     * Free-text grouping label ("Rooftop", "Garden", "Hall") — deliberately NOT an entity.
     * See V12's header for why a section is a label and a branch is a column.
     */
    @Column(name = "section", length = 50)
    private String section;

    /**
     * CATALOGUE state: does this table still exist in this restaurant. Distinct from
     * {@link #status}, which is RUNTIME state written by
     * {@code TableService.syncStatusForOrder} on every order transition. Conflating the
     * two would make an OCCUPIED table impossible to retire and a retired table flip
     * itself back to AVAILABLE when its last order closed.
     *
     * <p>There is no hard delete: {@code orders.table_id} references these rows and a
     * closed order must keep naming the table it was served at.
     */
    @Column(name = "is_active", nullable = false)
    private boolean active = true;

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
