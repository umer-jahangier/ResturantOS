package io.restaurantos.purchasing.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * Append-only, effective-dated price for one {@link VendorItem} (D-01 / RESEARCH §9.3 call 5). A
 * price change NEVER updates {@link #unitPricePaisa} on an existing row — it closes the prior
 * row's {@link #effectiveTo} and INSERTs a brand-new row. This is what makes price-change
 * reporting, contract-compliance checks and correct historical costing possible; the only
 * permitted mutation on a historical row is closing its {@code effectiveTo}.
 */
@Entity
@Table(name = "vendor_item_prices")
@Getter
@Setter
public class VendorItemPrice extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "vendor_item_id", nullable = false)
    private UUID vendorItemId;

    @Column(name = "branch_id")
    private UUID branchId;

    @Column(name = "unit_price_paisa", nullable = false)
    private long unitPricePaisa;

    @Column(name = "price_uom", nullable = false, length = 20)
    private String priceUom;

    @Column(name = "effective_from", nullable = false)
    private Instant effectiveFrom;

    @Column(name = "effective_to")
    private Instant effectiveTo;

    @Column(nullable = false, length = 20)
    private String source = "MANUAL";

    @Column(name = "is_contract_price", nullable = false)
    private boolean contractPrice = false;
}
