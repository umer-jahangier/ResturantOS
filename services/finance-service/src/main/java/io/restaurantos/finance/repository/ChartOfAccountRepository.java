package io.restaurantos.finance.repository;

import io.restaurantos.finance.domain.enums.AccountType;
import io.restaurantos.finance.domain.model.ChartOfAccount;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

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
}
