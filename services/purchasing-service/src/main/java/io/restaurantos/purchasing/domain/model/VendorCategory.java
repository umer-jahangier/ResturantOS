package io.restaurantos.purchasing.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

/**
 * A filter/suggestion tag linking a vendor to a category. These tags exist only to (a) pre-filter
 * pickers and (b) suggest a default vendor for items with no preferred vendor (RESEARCH §9.3 call
 * 1) — a category assignment is NEVER the gate that lets a purchase happen. No authorization
 * expression anywhere may reference a category; that decision belongs entirely to
 * {@link VendorItem} and the service layer. {@link #categoryId} is a cross-service soft reference
 * to inventory-service's {@code item_categories}; no FK is possible here.
 */
@Entity
@Table(name = "vendor_categories")
@Getter
@Setter
public class VendorCategory extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "vendor_id", nullable = false)
    private UUID vendorId;

    @Column(name = "category_id", nullable = false)
    private UUID categoryId;

    @Column(name = "category_name", length = 160)
    private String categoryName;

    @Column(name = "is_preferred", nullable = false)
    private boolean preferred = false;
}
