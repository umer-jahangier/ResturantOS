package io.restaurantos.crm.repository;

import io.restaurantos.crm.entity.LoyaltyAccountEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface LoyaltyAccountRepository extends JpaRepository<LoyaltyAccountEntity, UUID> {

    Optional<LoyaltyAccountEntity> findByCustomerId(UUID customerId);
}
