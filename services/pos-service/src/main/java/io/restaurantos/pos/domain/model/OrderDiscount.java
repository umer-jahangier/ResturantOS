package io.restaurantos.pos.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.util.UUID;

@Entity
@Table(name = "order_discounts")
@Getter
@Setter
public class OrderDiscount extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "order_id", nullable = false)
    private Order order;

    @Column(name = "order_item_id")
    private UUID orderItemId;

    @Column(name = "scope", nullable = false, length = 10)
    private String scope;

    @Column(name = "type", nullable = false, length = 10)
    private String type;

    @Column(name = "value", nullable = false, precision = 12, scale = 4)
    private BigDecimal value;

    @Column(name = "amount_paisa", nullable = false)
    private long amountPaisa = 0L;

    @Column(name = "applied_by")
    private UUID appliedBy;
}
