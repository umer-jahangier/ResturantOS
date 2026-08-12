package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.model.ModifierGroup;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * The modifier CATALOGUE's group reads (S6).
 *
 * <p>Every method carries an explicit {@code tenantId} predicate even though {@code
 * modifier_groups} is FORCE-RLS'd on the same column. That is not redundancy: callers here use an
 * empty result to REFUSE a write, and a plumbing break in the tenant GUC must present as "no such
 * group" rather than as somebody else's group. Same reasoning as
 * {@code MenuCategoryRepository.findByIdAndTenantId}.
 */
@Repository
public interface ModifierGroupRepository extends JpaRepository<ModifierGroup, UUID> {

    /**
     * Every live group on one dish, options eagerly joined, in the order the till renders them.
     *
     * <p>{@code LEFT JOIN FETCH} rather than a lazy walk: the configure dialog needs the options
     * with the groups, always, and one dish's catalogue arriving as 1 + N queries is 1 + N round
     * trips inside a cashier's tap. {@code DISTINCT} because the fetch join multiplies the group
     * row by its option count.
     */
    @Query("""
            SELECT DISTINCT g FROM ModifierGroup g
            LEFT JOIN FETCH g.modifiers
            WHERE g.tenantId = :tenantId
              AND g.menuItem.id = :menuItemId
              AND g.deletedAt IS NULL
            ORDER BY g.sortOrder ASC, g.name ASC
            """)
    List<ModifierGroup> findForItem(@Param("tenantId") UUID tenantId,
                                    @Param("menuItemId") UUID menuItemId);

    /**
     * The whole tenant's live catalogue in ONE read — what the till loads alongside the menu.
     *
     * <p>The alternative, a fetch per tap, puts a network round trip between the cashier's finger
     * and the dialog and makes an offline till unable to configure a dish at all. Groups exist only
     * for dishes that have them, so this is a small answer: the payload is proportional to what the
     * tenant actually configured, not to the size of the menu.
     */
    @Query("""
            SELECT DISTINCT g FROM ModifierGroup g
            LEFT JOIN FETCH g.modifiers
            WHERE g.tenantId = :tenantId
              AND g.deletedAt IS NULL
              AND g.active = true
            ORDER BY g.sortOrder ASC, g.name ASC
            """)
    List<ModifierGroup> findAllActiveForTenant(@Param("tenantId") UUID tenantId);

    /**
     * The groups one dish's order line is validated against — the resolver's own read.
     *
     * <p>Deliberately includes INACTIVE groups and inactive options, even though only the ACTIVE
     * ones are ENFORCED. A retired group must stop being a requirement the moment it is retired,
     * or retiring "Spice level" would make the dish unsellable; but an id belonging to a retired
     * row still has to be recognised, so the refusal can say "that option is no longer available"
     * rather than the flatly wrong "that option is not on this dish".
     */
    @Query("""
            SELECT DISTINCT g FROM ModifierGroup g
            LEFT JOIN FETCH g.modifiers
            WHERE g.tenantId = :tenantId
              AND g.menuItem.id IN :menuItemIds
              AND g.deletedAt IS NULL
            ORDER BY g.sortOrder ASC, g.name ASC
            """)
    List<ModifierGroup> findForItems(@Param("tenantId") UUID tenantId,
                                     @Param("menuItemIds") Collection<UUID> menuItemIds);

    Optional<ModifierGroup> findByIdAndTenantIdAndDeletedAtIsNull(UUID id, UUID tenantId);

    /**
     * A live group on the same dish already carrying this name, case-insensitively. Checked before
     * the insert so the 409 can name the field the manager typed into; the partial unique index
     * from V25 is still there and is still what survives a race.
     */
    @Query("""
            SELECT g FROM ModifierGroup g
            WHERE g.tenantId = :tenantId
              AND g.menuItem.id = :menuItemId
              AND g.deletedAt IS NULL
              AND lower(g.name) = lower(:name)
            """)
    Optional<ModifierGroup> findByItemAndName(@Param("tenantId") UUID tenantId,
                                              @Param("menuItemId") UUID menuItemId,
                                              @Param("name") String name);
}
