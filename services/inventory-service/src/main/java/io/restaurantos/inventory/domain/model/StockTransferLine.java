package io.restaurantos.inventory.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Maps to {@code stock_transfer_lines} (V1 migration, INV-05) — a single ingredient's shipped /
 * received / variance quantities within a {@link StockTransfer}. {@code unitCostPaisa} is captured
 * from the SOURCE branch's {@code avg_cost_paisa} at ship time — this is the Inventory-in-Transit
 * (account {@code 1320}) valuation carried on {@code TRANSFER_SHIPPED}/{@code TRANSFER_RECEIVED}/
 * {@code TRANSFER_VARIANCE} for Phase 9's finance consumer to post GL entries from.
 */
@Entity
@Table(name = "stock_transfer_lines")
@Getter
@Setter
public class StockTransferLine extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "transfer_id", nullable = false)
    private UUID transferId;

    @Column(name = "ingredient_id", nullable = false)
    private UUID ingredientId;

    @Column(name = "qty_shipped", nullable = false, precision = 18, scale = 4)
    private BigDecimal qtyShipped;

    @Column(name = "qty_received", precision = 18, scale = 4)
    private BigDecimal qtyReceived;

    @Column(name = "variance_qty", nullable = false, precision = 18, scale = 4)
    private BigDecimal varianceQty = BigDecimal.ZERO;

    @Column(name = "unit_cost_paisa", nullable = false)
    private long unitCostPaisa;
}
