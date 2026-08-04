package io.restaurantos.crm.repository;

import io.restaurantos.crm.entity.CustomerEntity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface CustomerRepository extends JpaRepository<CustomerEntity, UUID> {

    Page<CustomerEntity> findAllByTenantId(UUID tenantId, Pageable pageable);

    Optional<CustomerEntity> findByTenantIdAndPhone(UUID tenantId, String phone);

    /**
     * Search-as-you-type over phone and name, for the CRM customer grid and the POS picker.
     *
     * <p>Phone is matched as a prefix (a cashier types the number the customer reads out, left to
     * right); name is matched anywhere and case-insensitively. Tenant-scoped in the query as well
     * as by RLS — {@code customers} is FORCE ROW LEVEL SECURITY, but a predicate the reader can
     * see beats one it has to trust.
     */
    @Query("""
            SELECT c FROM CustomerEntity c
             WHERE c.tenantId = :tenantId
               AND (LOWER(c.name) LIKE LOWER(CONCAT('%', :q, '%'))
                    OR c.phone LIKE CONCAT(:q, '%'))
            """)
    Page<CustomerEntity> search(@Param("tenantId") UUID tenantId,
                                @Param("q") String q,
                                Pageable pageable);
}
