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
}
