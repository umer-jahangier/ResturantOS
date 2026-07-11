package io.restaurantos.purchasing.domain.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "tenant_match_tolerances")
@Getter
@Setter
public class TenantMatchTolerance {

    @Id
    @Column(name = "tenant_id")
    private UUID tenantId;

    @Column(name = "qty_over_pct", nullable = false, precision = 8, scale = 4)
    private BigDecimal qtyOverPct = BigDecimal.ZERO;

    @Column(name = "qty_under_pct", nullable = false, precision = 8, scale = 4)
    private BigDecimal qtyUnderPct = new BigDecimal("0.05");

    @Column(name = "price_over_pct", nullable = false, precision = 8, scale = 4)
    private BigDecimal priceOverPct = new BigDecimal("0.02");

    @Column(name = "price_under_pct", nullable = false, precision = 8, scale = 4)
    private BigDecimal priceUnderPct = new BigDecimal("0.10");

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();
}
