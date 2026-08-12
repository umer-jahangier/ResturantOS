package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.model.Modifier;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

/** Option-level reads for the modifier catalogue (S6). See {@link ModifierGroupRepository}. */
@Repository
public interface ModifierRepository extends JpaRepository<Modifier, UUID> {

    Optional<Modifier> findByIdAndTenantIdAndDeletedAtIsNull(UUID id, UUID tenantId);

    /**
     * A live option in the same group already carrying this name, case-insensitively. Two "Extra
     * cheese" rows in one group is a cashier's ambiguity, not a catalogue.
     */
    @Query("""
            SELECT m FROM Modifier m
            WHERE m.tenantId = :tenantId
              AND m.modifierGroup.id = :groupId
              AND m.deletedAt IS NULL
              AND lower(m.name) = lower(:name)
            """)
    Optional<Modifier> findByGroupAndName(@Param("tenantId") UUID tenantId,
                                          @Param("groupId") UUID groupId,
                                          @Param("name") String name);

    /**
     * How many live options this group holds — the guard that stops a group being saved with a
     * minimum nobody can satisfy ("choose 2" over one option is a dialog with no exit).
     */
    @Query("""
            SELECT count(m) FROM Modifier m
            WHERE m.tenantId = :tenantId
              AND m.modifierGroup.id = :groupId
              AND m.deletedAt IS NULL
              AND m.active = true
            """)
    long countActiveInGroup(@Param("tenantId") UUID tenantId, @Param("groupId") UUID groupId);
}
