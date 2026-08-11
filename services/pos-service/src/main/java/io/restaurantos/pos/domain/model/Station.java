package io.restaurantos.pos.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

/**
 * Canonical KDS station (Phase 3 — Station Routing Refactor). Tenant + branch scoped;
 * unique on (tenant_id, branch_id, code). Owned by pos_db so {@code menu_items.station_id}
 * can carry a real SQL foreign key. The kitchen-service keeps its own {@code kds_stations}
 * table as an event-fed PROJECTION of these rows (cross-DB — no SQL FK across services).
 */
@Entity
@Table(name = "stations")
@Getter
@Setter
public class Station extends TenantAuditableEntity {

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
     * What kind of destination this is (D-28-01) — and therefore which display shows its tickets.
     *
     * <p>NOT NULL with a database default of {@code KITCHEN}, which is the whole back-compatibility
     * story: every station that existed before phase 28 renders on the KDS, so every one of them
     * becomes a kitchen station and nothing about today's routing moves. See {@link StationType}
     * for the five values and the three display families they map onto.
     *
     * <p>Stored as a STRING, not an ordinal. An ordinal would silently re-point every existing row
     * the day someone inserted a value into the middle of the enum, and the CHECK constraint in
     * V14 is written against the names.
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "station_type", nullable = false, length = 20)
    private StationType stationType = StationType.DEFAULT;
}
