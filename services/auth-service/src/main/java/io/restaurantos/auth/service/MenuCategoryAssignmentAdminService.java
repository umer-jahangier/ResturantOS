package io.restaurantos.auth.service;

import io.restaurantos.auth.dto.response.MenuCategoryAssignmentResponse;
import io.restaurantos.auth.entity.UserMenuCategoryAssignmentEntity;
import io.restaurantos.auth.repository.UserMenuCategoryAssignmentRepository;
import io.restaurantos.auth.repository.UserRepository;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import jakarta.persistence.EntityManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * The only write path for {@code user_menu_category_assignments} (Program A).
 *
 * <p>Mirrors {@link StationAssignmentAdminService} line for line: same tenant-GUC discipline, same
 * cross-tenant answer, same soft-deactivation, same replace-not-merge semantics. That is deliberate
 * — confining a cashier to the bar and assigning them a kitchen station are the same kind of
 * decision made in the same form, and two admin services for one form that disagreed about what a
 * foreign user id means would be a seam to walk through.
 */
@Service
public class MenuCategoryAssignmentAdminService {

    private static final Logger log = LoggerFactory.getLogger(MenuCategoryAssignmentAdminService.class);

    private final UserMenuCategoryAssignmentRepository repository;
    private final UserRepository userRepository;
    private final EntityManager entityManager;

    public MenuCategoryAssignmentAdminService(UserMenuCategoryAssignmentRepository repository,
                                              UserRepository userRepository,
                                              EntityManager entityManager) {
        this.repository = repository;
        this.userRepository = userRepository;
        this.entityManager = entityManager;
    }

    /**
     * Set the categories a user may ring at one branch to exactly this set.
     *
     * <p><b>Replace, not merge.</b> The admin UI edits a checkbox list and submits what the list now
     * says. A replace is the honest model of that interaction and is idempotent by construction: the
     * same request twice leaves the same rows, because rows not named are deactivated and rows named
     * are reactivated in place rather than re-inserted.
     *
     * <p>Reactivating in place is not an optimisation. The unique constraint on
     * {@code (tenant_id, user_id, branch_id, category_id)} would reject a second row for a category
     * the user was previously removed from, so a delete-then-insert implementation would work in
     * every test that assigns once and fail the first time an administrator changed their mind.
     *
     * <p><b>An empty set clears the branch and returns the user to the WHOLE menu.</b> That must
     * stay expressible: it is where every user in the product starts, and every layer below reads
     * "no rows" as "no restriction" — the resolver mints no claim, and {@code pos.rego}'s
     * unrestricted rule matches. There is no other spelling of unrestricted anywhere in this stack,
     * on purpose.
     *
     * <p><b>The category ids are deliberately NOT validated against pos-service.</b> This service has
     * no route into pos_db and should not grow one. An unknown id scopes that user to a category
     * that produces no items — visible on their own screen within one shift, and self-correcting. A
     * synchronous cross-service validation on the user-admin path would instead make editing a user
     * fail whenever pos-service is redeploying, which is a worse failure for a worse reason. Same
     * call, same reasoning, as {@code StationAssignmentAdminService.replaceForBranch}; the typo
     * prevention belongs in the admin UI, which sources the category list from pos-service.
     *
     * <p>Note what is NOT normalised here, in contrast to that sibling: station codes are trimmed and
     * upper-cased because they are free text an operator types, and "bar", "BAR " and "BAR" arriving
     * as three assignments is a real failure. A UUID has one spelling. It is de-duplicated and
     * nothing else.
     */
    @Transactional
    public List<MenuCategoryAssignmentResponse> replaceForBranch(UUID tenantId, UUID userId,
                                                                 UUID branchId, List<UUID> categoryIds) {
        setTenantGuc(tenantId);
        requireUserInTenant(tenantId, userId);

        Set<UUID> wanted = new LinkedHashSet<>(categoryIds.stream()
            .filter(Objects::nonNull)
            .sorted()
            .toList());

        List<UserMenuCategoryAssignmentEntity> existing =
            repository.findByTenantIdAndUserIdAndBranchId(tenantId, userId, branchId);

        for (UserMenuCategoryAssignmentEntity row : existing) {
            boolean shouldBeActive = wanted.remove(row.getCategoryId());
            if (row.isActive() != shouldBeActive) {
                row.setActive(shouldBeActive);
                repository.save(row);
            }
        }
        for (UUID categoryId : wanted) {
            UserMenuCategoryAssignmentEntity row = new UserMenuCategoryAssignmentEntity();
            row.setId(UUID.randomUUID());
            row.setTenantId(tenantId);
            row.setUserId(userId);
            row.setBranchId(branchId);
            row.setCategoryId(categoryId);
            row.setActive(true);
            repository.save(row);
        }

        // Logged at INFO and naming the branch, because this is the write that decides what a person
        // can sell. When a cashier reports "I cannot ring food any more", this line is the answer.
        log.info("Menu-category scope for user {} at branch {} replaced with {} categories {}",
            userId, branchId, categoryIds.size(), categoryIds);

        return list(tenantId, userId);
    }

    /** A user's active assignments, grouped by branch. */
    @Transactional(readOnly = true)
    public List<MenuCategoryAssignmentResponse> list(UUID tenantId, UUID userId) {
        setTenantGuc(tenantId);
        requireUserInTenant(tenantId, userId);
        return MenuCategoryAssignmentResponse.groupByBranch(
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
     * {@code TenantAwareDataSource} sets no GUC, and {@code user_menu_category_assignments} is
     * FORCE ROW LEVEL SECURITY — the INSERT is rejected outright with "new row violates row-level
     * security policy". {@code BranchRoleAdminService} shipped without this and the only write path
     * for {@code user_branch_roles} did not work against any database that actually enforces RLS;
     * the whole suite was green because Testcontainers' Postgres user is a superuser.
     */
    private void setTenantGuc(UUID tenantId) {
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
            .setParameter("tid", tenantId.toString())
            .getSingleResult();
    }
}
