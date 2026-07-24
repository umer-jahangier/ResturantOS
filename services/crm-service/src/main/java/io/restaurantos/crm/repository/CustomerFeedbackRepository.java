package io.restaurantos.crm.repository;

import io.restaurantos.crm.entity.CustomerFeedbackEntity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface CustomerFeedbackRepository extends JpaRepository<CustomerFeedbackEntity, UUID> {

    Page<CustomerFeedbackEntity> findByTenantId(UUID tenantId, Pageable pageable);
}
