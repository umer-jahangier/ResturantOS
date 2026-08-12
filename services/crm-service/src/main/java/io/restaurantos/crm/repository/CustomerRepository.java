package io.restaurantos.crm.repository;

import io.restaurantos.crm.entity.CustomerEntity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
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

    /**
     * The ids alone for the same match rule as {@link #search} — the POS order search's
     * "which customers does this phone belong to?" leg (S0-05).
     *
     * <p>Ids rather than whole customers on purpose: pos-service only needs them to build an
     * {@code o.customerId IN (…)} predicate, and shipping names/emails/birthdays across a service
     * boundary for that would be handing PII to a caller with no use for it.
     */
    @Query("""
            SELECT c.id FROM CustomerEntity c
             WHERE c.tenantId = :tenantId
               AND (LOWER(c.name) LIKE LOWER(CONCAT('%', :q, '%'))
                    OR c.phone LIKE CONCAT(:q, '%'))
            """)
    List<UUID> searchIds(@Param("tenantId") UUID tenantId,
                         @Param("q") String q,
                         Pageable pageable);
}
