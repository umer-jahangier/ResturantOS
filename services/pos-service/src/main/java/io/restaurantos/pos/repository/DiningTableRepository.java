package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.model.DiningTable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface DiningTableRepository extends JpaRepository<DiningTable, UUID> {

    @Query("SELECT t FROM DiningTable t WHERE t.branchId = :branchId ORDER BY t.tableNumber ASC")
    List<DiningTable> findByBranchId(@Param("branchId") UUID branchId);

    @Query("SELECT t FROM DiningTable t WHERE t.id = :id AND t.branchId = :branchId")
    Optional<DiningTable> findByIdAndBranchId(@Param("id") UUID id, @Param("branchId") UUID branchId);
}
