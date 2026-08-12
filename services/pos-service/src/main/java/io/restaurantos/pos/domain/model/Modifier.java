package io.restaurantos.pos.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

@Entity
@Table(name = "modifiers")
@Getter
@Setter
public class Modifier extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "modifier_group_id", nullable = false)
    private ModifierGroup modifierGroup;

    @Column(name = "name", nullable = false, length = 100)
    private String name;

    /**
     * BIGINT paisa, and deliberately signed: "no cheese, -Rs 50" is as real as "extra cheese,
     * +Rs 150". Never a float, and never a percentage — a modifier moves the LINE price by a
     * fixed amount, and anything percentage-shaped in this product goes through
     * {@code PercentOfPaisa} HALF_UP, which this is not.
     */
    @Column(name = "price_delta_paisa", nullable = false)
    private long priceDeltaPaisa = 0L;

    /** The order the cashier sees the options in inside their group. */
    @Column(name = "sort_order", nullable = false)
    private int sortOrder = 0;

    @Column(name = "active", nullable = false)
    private boolean active = true;
}
