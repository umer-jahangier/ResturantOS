package io.restaurantos.auth.service;

import io.restaurantos.auth.dto.response.StationAssignmentResponse;
import io.restaurantos.auth.entity.UserStationAssignmentEntity;
import io.restaurantos.auth.repository.UserStationAssignmentRepository;
import io.restaurantos.auth.repository.UserRepository;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import jakarta.persistence.EntityManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * The only write path for {@code user_station_assignments} (D-28-02, D-28-05).
 *
 * <p>Mirrors {@link BranchRoleAdminService}: same tenant-GUC discipline, same cross-tenant answer,
 * same soft-deactivation. That is deliberate — assigning a station and assigning a role are the
 * same kind of decision made in the same form, and two admin services for one form that disagreed
 * about what a foreign user id means would be a seam to walk through.
 */
@Service
public class StationAssignmentAdminService {

    private static final Logger log = LoggerFactory.getLogger(StationAssignmentAdminService.class);

    private final UserStationAssignmentRepository repository;
    private final UserRepository userRepository;
    private final EntityManager entityManager;

    public StationAssignmentAdminService(UserStationAssignmentRepository repository,
                                         UserRepository userRepository,
                                         EntityManager entityManager) {
        this.repository = repository;
        this.userRepository = userRepository;
        this.entityManager = entityManager;
    }

    /**
     * Set a user's stations at one branch to exactly this set.
     *
     * <p><b>Replace, not merge.</b> The admin UI edits a checkbox list and submits what the list now
     * says. A replace is the honest model of that interaction and is idempotent by construction: the
     * same request twice leaves the same rows, because rows not named are deactivated and rows named
     * are reactivated in place rather than re-inserted.
     *
     * <p>Reactivating in place is not an optimisation. The unique constraint on
     * {@code (tenant_id, user_id, branch_id, station_code)} would reject a second row for a station
     * the user was previously removed from, so a delete-then-insert implementation would work in
     * every test that assigns once and fail the first time an administrator changed their mind.
     *
     * <p>An empty set clears the branch and returns the user to unrestricted. That must stay
     * expressible: it is where every user in the product starts, and the resolver reads "no rows" as
     * "no restriction" (see {@code PermissionResolver.putStationScope}).
     *
     * <p><b>The codes are deliberately NOT validated against pos-service.</b> This service has no
     * route into pos_db and should not grow one. An unknown code filters that user down to a station
     * that produces no tickets — visible on their own screen within one shift, and self-correcting.
     * A synchronous cross-service validation on the user-admin path would instead make editing a
     * user fail whenever pos-service is redeploying, which is a worse failure for a worse reason.
     * The typo prevention belongs in the admin UI, which sources the code list from pos-service.
     */
    @Transactional
    public List<StationAssignmentResponse> replaceForBranch(UUID tenantId, UUID userId, UUID branchId,
                                                            List<String> stationCodes) {
        setTenantGuc(tenantId);
        requireUserInTenant(tenantId, userId);

        // Normalised once, here: trimmed, uppercased and de-duplicated. Station codes are an enum-ish
        // routing key downstream, and "bar", "BAR " and "BAR" arriving as three assignments is the
        // free-text failure D-28-01 rejects for the station catalogue itself.
        Set<String> wanted = new LinkedHashSet<>(stationCodes.stream()
            .filter(c -> c != null && !c.isBlank())
            .map(c -> c.trim().toUpperCase())
            .sorted()
            .toList());

        List<UserStationAssignmentEntity> existing =
            repository.findByTenantIdAndUserIdAndBranchId(tenantId, userId, branchId);

        for (UserStationAssignmentEntity row : existing) {
            boolean shouldBeActive = wanted.remove(row.getStationCode());
            if (row.isActive() != shouldBeActive) {
                row.setActive(shouldBeActive);
                repository.save(row);
            }
        }
        for (String code : wanted) {
            UserStationAssignmentEntity row = new UserStationAssignmentEntity();
            row.setId(UUID.randomUUID());
            row.setTenantId(tenantId);
            row.setUserId(userId);
            row.setBranchId(branchId);
            row.setStationCode(code);
            row.setActive(true);
            repository.save(row);
        }

        log.info("Station assignment for user {} at branch {} replaced with {}",
            userId, branchId, stationCodes);

        return list(tenantId, userId);
    }

    /** A user's active assignments, grouped by branch. */
    @Transactional(readOnly = true)
    public List<StationAssignmentResponse> list(UUID tenantId, UUID userId) {
        setTenantGuc(tenantId);
        requireUserInTenant(tenantId, userId);
        return StationAssignmentResponse.groupByBranch(
            repository.findByTenantIdAndUserIdAndActiveTrue(tenantId, userId));
    }

    /**
     * The target user must be a live user OF THIS TENANT, or this is a 404.
     *
     * <p>Same posture and the same reasoning as {@code BranchRoleAdminService.requireUserInTenant}:
     * <b>404, not 403</b>, so a foreign user id answers identically to a nonexistent one and the
     * endpoint cannot be walked to learn which accounts exist elsewhere on the platform.
     *
     * <p>{@code findByIdForTenant} carries {@code tenant_id} in the query as well as relying on the
     * RLS policy, because Testcontainers runs as a SUPERUSER and the policy is inert in every
     * integration test here. The predicate is what CI can actually assert.
     */
    private void requireUserInTenant(UUID tenantId, UUID userId) {
        userRepository.findByIdForTenant(userId, tenantId)
            .orElseThrow(() -> new ResourceNotFoundException("User not found"));
    }

    /**
     * Sets the RLS tenant GUC inside the active transaction.
     *
     * <p>Not optional and not belt-and-braces. {@code /internal/auth/**} carries no JWT, so
     * {@code JwtAuthenticationFilter} never populates {@code TenantContext},
     * {@code TenantAwareDataSource} sets no GUC, and {@code user_station_assignments} is FORCE ROW
     * LEVEL SECURITY — the INSERT is rejected outright with "new row violates row-level security
     * policy". {@code BranchRoleAdminService} shipped without this and the only write path for
     * {@code user_branch_roles} did not work against any database that actually enforces RLS; the
     * whole suite was green because Testcontainers' Postgres user is a superuser.
     */
    private void setTenantGuc(UUID tenantId) {
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
            .setParameter("tid", tenantId.toString())
            .getSingleResult();
    }
}
