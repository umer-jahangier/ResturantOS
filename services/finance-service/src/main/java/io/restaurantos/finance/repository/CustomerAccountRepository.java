package io.restaurantos.finance.repository;

import io.restaurantos.finance.domain.model.CustomerAccount;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface CustomerAccountRepository extends JpaRepository<CustomerAccount, UUID> {

    Page<CustomerAccount> findByTenantIdAndDeletedAtIsNull(UUID tenantId, Pageable pageable);

    Optional<CustomerAccount> findByTenantIdAndId(UUID tenantId, UUID id);

    boolean existsByTenantIdAndAccountCode(UUID tenantId, String accountCode);
}
