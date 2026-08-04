package io.restaurantos.inventory.repository;

import io.restaurantos.inventory.domain.model.StockWastage;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface StockWastageRepository extends JpaRepository<StockWastage, UUID> {

    List<StockWastage> findByTenantIdAndBranchIdOrderByRecordedAtDesc(UUID tenantId, UUID branchId);
}
