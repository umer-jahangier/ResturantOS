package io.restaurantos.crm.repository;

import io.restaurantos.crm.entity.LoyaltyTransactionEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface LoyaltyTransactionRepository extends JpaRepository<LoyaltyTransactionEntity, UUID> {
}
