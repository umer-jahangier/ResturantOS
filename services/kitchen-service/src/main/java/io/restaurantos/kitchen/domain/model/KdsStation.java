package io.restaurantos.kitchen.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

@Entity
@Table(name = "kds_stations")
@Getter
@Setter
public class KdsStation extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Column(name = "code", nullable = false, length = 50)
    private String code;

    @Column(name = "name", nullable = false, length = 100)
    private String name;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;

    /**
     * Canonical pos-owned station id this projected row mirrors (Phase 3). Null for rows that
     * were auto-vivified from a free-text code (e.g. DEFAULT) with no canonical source.
     */
    @Column(name = "source_station_id")
    private UUID sourceStationId;

    @Column(name = "escalation_threshold_seconds", nullable = false)
    private int escalationThresholdSeconds = 900;
}
