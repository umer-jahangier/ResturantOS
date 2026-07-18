package io.restaurantos.inventory.repository;

import io.restaurantos.inventory.domain.model.StockTransferLine;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface StockTransferLineRepository extends JpaRepository<StockTransferLine, UUID> {

    List<StockTransferLine> findByTransferId(UUID transferId);
}
