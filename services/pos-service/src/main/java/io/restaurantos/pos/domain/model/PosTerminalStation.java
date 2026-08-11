package io.restaurantos.pos.domain.model;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

/**
 * One station a terminal FIRES TO (D-28-03).
 *
 * <p><b>No rows for a terminal means it fires to every station</b> — the same empty-means-all rule
 * {@link PosTerminalCategory} carries, and for the same back-compatibility reason.
 *
 * <p>References a station by id, which is safe here because both tables live in pos_db. That is the
 * opposite of the choice made in auth_db's {@code user_station_assignments}, which stores the CODE
 * precisely because it is a different database and a UUID there would be a foreign key nothing can
 * enforce.
 */
@Entity
@Table(name = "pos_terminal_stations")
@Getter
@Setter
public class PosTerminalStation extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "terminal_id", nullable = false)
    private UUID terminalId;

    @Column(name = "station_id", nullable = false)
    private UUID stationId;
}
