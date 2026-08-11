package io.restaurantos.auth.entity;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

/**
 * One station a user works, at one branch (D-28-02).
 *
 * <p>A user with rows here sees only those stations' tickets. A user with NO rows sees everything
 * at their branch, which is what every user in the product has today and must keep having — see
 * {@code PermissionResolver.buildForAssignment} for why that default is encoded as an ABSENT claim
 * key rather than an empty list.
 *
 * <p>{@link #stationCode} is the station's CODE, not its id, and that is deliberate. pos_db and
 * auth_db are separate databases, so a UUID here would be a foreign key this codebase can neither
 * declare nor enforce. The code is already the routing key everywhere downstream — kitchen tickets
 * carry it, the KDS subscription key is built from it, and ticket grouping keys on it — and
 * {@code StationServiceImpl.updateStation} cannot change a code once created, so a stored code
 * cannot go stale under a rename.
 *
 * <p>Rows are deactivated rather than deleted, matching {@link UserBranchRoleEntity}, so an audit
 * reader can still see that a bartender used to be on BAR.
 */
@Entity
@Table(name = "user_station_assignments")
@Getter
@Setter
public class UserStationAssignmentEntity extends TenantAuditableEntity {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    /**
     * The branch this assignment applies at. NOT NULL by construction: a station code is only
     * unique within a (tenant, branch), so a branch-less assignment could not be interpreted.
     */
    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Column(name = "station_code", nullable = false)
    private String stationCode;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;
}
