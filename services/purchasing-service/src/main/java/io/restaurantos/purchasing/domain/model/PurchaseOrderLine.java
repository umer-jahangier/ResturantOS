package io.restaurantos.purchasing.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.util.UUID;

@Entity
@Table(name = "purchase_order_lines")
@Getter
@Setter
public class PurchaseOrderLine extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "purchase_order_id", nullable = false)
    private PurchaseOrder purchaseOrder;

    @Column(name = "ingredient_id", nullable = false)
    private UUID ingredientId;

    @Column(nullable = false, precision = 18, scale = 4)
    private BigDecimal qty;

    @Column(nullable = false, length = 20)
    private String uom;

    @Column(name = "unit_price_paisa", nullable = false)
    private long unitPricePaisa;

    @Column(name = "line_total_paisa", nullable = false)
    private long lineTotalPaisa;
}
