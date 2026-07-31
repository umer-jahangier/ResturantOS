package io.restaurantos.finance.repository;

import io.restaurantos.finance.domain.enums.AccountType;
import io.restaurantos.finance.domain.model.ChartOfAccount;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface ChartOfAccountRepository extends JpaRepository<ChartOfAccount, UUID> {

    Optional<ChartOfAccount> findByCode(String code);

    Optional<ChartOfAccount> findByTenantIdAndCode(UUID tenantId, String code);

    Page<ChartOfAccount> findByAccountTypeAndActive(AccountType accountType, boolean active, Pageable pageable);

    Page<ChartOfAccount> findByActive(boolean active, Pageable pageable);

    Page<ChartOfAccount> findByAccountType(AccountType accountType, Pageable pageable);

    List<ChartOfAccount> findBySystemTag(String systemTag);

    boolean existsByCode(String code);

    boolean existsByTenantIdAndCode(UUID tenantId, String code);

    long countByTenantId(UUID tenantId);

    @Query("""
            SELECT c FROM ChartOfAccount c
            WHERE c.active = true
              AND (LOWER(c.code) LIKE LOWER(CONCAT('%', :q, '%'))
                   OR LOWER(c.name) LIKE LOWER(CONCAT('%', :q, '%')))
            ORDER BY c.code
            """)
    Page<ChartOfAccount> searchActiveByCodeOrName(@Param("q") String q, Pageable pageable);

    /**
     * Type-narrowed variant of {@link #searchActiveByCodeOrName} for pickers that may only offer
     * accounts of certain types — inventory's category form must not let a manager file a revenue
     * account under "Inventory GL account". A blank {@code q} matches everything, so the picker can
     * show a sensible starting list before the user types.
     *
     * <p>Explicitly tenant-scoped rather than leaning on the ambient filter: this backs a
     * cross-service seam where the caller supplies the tenant, so the scoping must be visible in
     * the query itself.
     */
    @Query("""
            SELECT c FROM ChartOfAccount c
            WHERE c.tenantId = :tenantId
              AND c.active = true
              AND c.accountType IN :types
              AND (:q = '' OR LOWER(c.code) LIKE LOWER(CONCAT('%', :q, '%'))
                           OR LOWER(c.name) LIKE LOWER(CONCAT('%', :q, '%')))
            ORDER BY c.code
            """)
    Page<ChartOfAccount> searchActiveByTypeAndCodeOrName(@Param("tenantId") UUID tenantId,
                                                          @Param("types") Collection<AccountType> types,
                                                          @Param("q") String q,
                                                          Pageable pageable);

    /** Batch resolve for write-time validation — one query however many codes are supplied. */
    List<ChartOfAccount> findByTenantIdAndCodeIn(UUID tenantId, Collection<String> codes);

    List<ChartOfAccount> findByTenantIdAndIdIn(UUID tenantId, Collection<UUID> ids);
}
