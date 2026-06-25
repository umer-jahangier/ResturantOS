package io.restaurantos.platform.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * Telemetry record for a tenant's resource consumption.
 * NOT tenant-scoped — platform_db has no RLS (SC4/PLATFORM-07).
 * Column qty stores the raw delta; the API accepts field name "delta".
 */
@Entity
@Table(name = "usage_records")
@Getter
@Setter
public class UsageRecordEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(nullable = false, length = 50)
    private String resource;

    @Column(nullable = false, precision = 20, scale = 4)
    private BigDecimal qty;

    @Column(name = "recorded_at", nullable = false)
    private Instant recordedAt = Instant.now();
}
