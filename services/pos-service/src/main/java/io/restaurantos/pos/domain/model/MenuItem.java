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

    @Column(name = "kds_station")
    private String kdsStation;

    /**
     * Canonical station assignment (Phase 3). FK to stations(id); nullable until an admin
     * assigns one. The free-text {@link #kdsStation} is retained for back-compat routing.
     */
    @Column(name = "station_id")
    private UUID stationId;

    @Column(name = "active", nullable = false)
    private boolean active = true;
}
