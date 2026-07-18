package io.restaurantos.inventory.repository;

import io.restaurantos.inventory.domain.model.StockCount;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface StockCountRepository extends JpaRepository<StockCount, UUID> {

    List<StockCount> findByStatus(String status);

    List<StockCount> findByBranchId(UUID branchId);
}
