package io.restaurantos.crm.repository;

import io.restaurantos.crm.entity.CustomerEntity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface CustomerRepository extends JpaRepository<CustomerEntity, UUID> {

    Page<CustomerEntity> findAllByTenantId(UUID tenantId, Pageable pageable);

    Optional<CustomerEntity> findByTenantIdAndPhone(UUID tenantId, String phone);
}
