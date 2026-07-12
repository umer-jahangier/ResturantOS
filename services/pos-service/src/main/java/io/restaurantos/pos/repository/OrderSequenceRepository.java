package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.model.OrderSequence;
import io.restaurantos.pos.domain.model.OrderSequenceId;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface OrderSequenceRepository extends JpaRepository<OrderSequence, OrderSequenceId> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT s FROM OrderSequence s WHERE s.tenantId = :tenantId AND s.branchId = :branchId AND s.businessDate = :businessDate")
    Optional<OrderSequence> findForUpdate(
            @Param("tenantId") UUID tenantId,
            @Param("branchId") UUID branchId,
            @Param("businessDate") LocalDate businessDate);
}
