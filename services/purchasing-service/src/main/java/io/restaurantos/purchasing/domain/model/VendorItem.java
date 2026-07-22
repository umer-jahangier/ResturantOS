package io.restaurantos.purchasing.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * A vendor's catalog row: vendor SKU, pack size, purchase UOM, MOQ and lead time for exactly one
 * ingredient. Many {@code VendorItem} rows may point at the same {@link #ingredientId} — a vendor
 * legitimately sells the same ingredient in more than one pack size (RESEARCH §9.2/§9.4) — but
 * {@link #ingredientId} is immutable once set: re-mapping a catalog row to a different ingredient
 * would rewrite the meaning of historical PO/invoice lines, so a re-map creates a new vendor item.
 * {@code ingredientId} is a deliberate cross-service soft reference (ingredients live in
 * inventory_db, a separate database); no FK is possible here.
 */
@Entity
@Table(name = "vendor_items")
@Getter
@Setter
public class VendorItem extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "vendor_id", nullable = false)
    private UUID vendorId;

    @Column(name = "ingredient_id", nullable = false)
    private UUID ingredientId;

    @Column(name = "vendor_sku", length = 80)
    private String vendorSku;

    @Column(name = "vendor_description", length = 240)
    private String vendorDescription;

    @Column(length = 20)
    private String gtin;

    @Column(name = "order_uom", nullable = false, length = 20)
    private String orderUom;

    @Column(name = "pack_description", length = 80)
    private String packDescription;

    @Column(name = "pack_qty", nullable = false, precision = 18, scale = 4)
    private BigDecimal packQty = BigDecimal.ONE;

    @Column(name = "pack_uom", nullable = false, length = 20)
    private String packUom;

    @Column(name = "qty_per_order_unit_in_stock_uom", precision = 18, scale = 6)
    private BigDecimal qtyPerOrderUnitInStockUom;

    @Column(name = "min_order_qty", precision = 18, scale = 4)
    private BigDecimal minOrderQty;

    @Column(name = "order_multiple", precision = 18, scale = 4)
    private BigDecimal orderMultiple;

    @Column(name = "lead_time_days")
    private Integer leadTimeDays;

    @Column(name = "is_preferred", nullable = false)
    private boolean preferred = false;

    @Column(name = "is_catch_weight", nullable = false)
    private boolean catchWeight = false;

    @Column(name = "archived_at")
    private Instant archivedAt;
}
