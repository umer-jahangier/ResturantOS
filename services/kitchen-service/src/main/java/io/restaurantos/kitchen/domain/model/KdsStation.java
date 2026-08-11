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

    /**
     * The KIND of destination this station is (D-28-01), projected from the fire event.
     *
     * <p>NOT NULL with a database default of {@code KITCHEN} (V9): every projected row that exists
     * today feeds a kitchen board, so every one of them becomes KITCHEN and nothing moves. Stored
     * as a STRING, never an ordinal — an ordinal would re-point every existing row the day a value
     * was inserted into the middle of the enum, and V9's CHECK constraint is written against names.
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "station_type", nullable = false, length = 20)
    private StationType stationType = StationType.DEFAULT;
}
