package io.restaurantos.inventory.repository;

import io.restaurantos.inventory.domain.model.StockWastageLine;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface StockWastageLineRepository extends JpaRepository<StockWastageLine, UUID> {

    List<StockWastageLine> findByWastageId(UUID wastageId);
}
