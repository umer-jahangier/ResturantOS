package io.restaurantos.purchasing.repository;

import io.restaurantos.purchasing.domain.model.ApPayment;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface ApPaymentRepository extends JpaRepository<ApPayment, UUID> {

    Optional<ApPayment> findByTenantIdAndIdempotencyKey(UUID tenantId, String idempotencyKey);
}
