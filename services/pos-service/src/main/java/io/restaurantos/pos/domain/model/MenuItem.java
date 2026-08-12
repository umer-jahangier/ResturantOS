package io.restaurantos.pos.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.util.UUID;

@Entity
@Table(name = "menu_items")
@Getter
@Setter
public class MenuItem extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "category_id", nullable = false)
    private MenuCategory category;

    @Column(name = "name", nullable = false, length = 150)
    private String name;

    @Column(name = "description")
    private String description;

    @Column(name = "base_price_paisa", nullable = false)
    private long basePricePaisa = 0L;

    @Column(name = "tax_rate_pct", nullable = false, precision = 5, scale = 2)
    private BigDecimal taxRatePct = BigDecimal.ZERO;

    @Column(name = "tax_rate_code")
    private String taxRateCode;

    /**
     * This item's tax-class OVERRIDE (F16). NULL means INHERIT THE CATEGORY'S — it does not mean
     * zero-rated, and confusing the two is how a menu ends up taxing 1.5% of a check.
     *
     * <p>{@link #taxRatePct} and {@link #taxRateCode} above are the LAST step of the resolution
     * order, not a parallel one: they are the custom rate of an item that belongs to no class,
     * which is what every row in every existing tenant is on the day F16 ships. See
     * {@link io.restaurantos.pos.service.TaxClassResolver}.
     */
    @Column(name = "tax_class_id")
    private UUID taxClassId;

    @Column(name = "kds_station")
    private String kdsStation;

    /**
     * Canonical station assignment (Phase 3). FK to stations(id); nullable until an admin
     * assigns one. The free-text {@link #kdsStation} is retained for back-compat routing.
     */
    @Column(name = "station_id")
    private UUID stationId;

    /**
     * file-service file id for this item's picture, or null. Deliberately the ID and not a URL:
     * {@code MenuItemDto} derives {@code imageUrl} as {@code /api/v1/files/{id}/download}, so
     * changing that route is a one-line change rather than a data migration across every row.
     *
     * <p>No JPA relationship and no FK — {@code file_metadata} lives in {@code file_db}, owned
     * by file-service. Integrity is enforced at the application boundary by
     * {@link io.restaurantos.pos.service.MenuItemImageService}, which resolves the id against
     * file-service before any write persists it.
     */
    @Column(name = "image_file_id")
    private UUID imageFileId;

    @Column(name = "active", nullable = false)
    private boolean active = true;
}
