package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.model.TaxClass;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface TaxClassRepository extends JpaRepository<TaxClass, UUID> {

    /**
     * Every live class, retired ones last, then by rate descending.
     *
     * <p>Rate-descending rather than alphabetical on purpose: the standard rate is the one a
     * manager reaches for on nearly every dish, and it is nearly always the highest.
     */
    @Query("""
            SELECT t FROM TaxClass t
            WHERE t.tenantId = :tenantId AND t.deletedAt IS NULL
            ORDER BY t.active DESC, t.ratePct DESC, t.name ASC
            """)
    List<TaxClass> findAllForTenant(UUID tenantId);

    /**
     * The explicit tenant predicate is not redundant with the RLS policy — see
     * {@code MenuCategoryRepository.findByIdAndTenantId} for why. Callers here use the empty
     * result to REFUSE a write, so a plumbing break must present as "no such class", not as a
     * class from somebody else's tenant.
     */
    Optional<TaxClass> findByIdAndTenantIdAndDeletedAtIsNull(UUID id, UUID tenantId);

    @Query("""
            SELECT t FROM TaxClass t
            WHERE t.tenantId = :tenantId AND t.deletedAt IS NULL AND upper(t.code) = upper(:code)
            """)
    Optional<TaxClass> findByTenantAndCode(UUID tenantId, String code);

    /** How many categories still point at this class — the delete guard's first question. */
    @Query("SELECT count(c) FROM MenuCategory c WHERE c.tenantId = :tenantId AND c.taxClassId = :taxClassId")
    long countCategoriesUsing(UUID tenantId, UUID taxClassId);

    /** How many items still override to this class — the delete guard's second question. */
    @Query("SELECT count(i) FROM MenuItem i WHERE i.tenantId = :tenantId AND i.taxClassId = :taxClassId")
    long countItemsUsing(UUID tenantId, UUID taxClassId);
}
