package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.model.Order;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface OrderRepository extends JpaRepository<Order, UUID> {

    @Query("SELECT o FROM Order o WHERE o.id = :id AND o.branchId = :branchId")
    Optional<Order> findByIdAndBranchId(@Param("id") UUID id, @Param("branchId") UUID branchId);

    @Query("SELECT o FROM Order o WHERE o.clientOrderId = :clientOrderId")
    Optional<Order> findByClientOrderId(@Param("clientOrderId") UUID clientOrderId);

    @Query("SELECT o FROM Order o WHERE o.branchId = :branchId AND o.status IN :statuses ORDER BY o.createdAt DESC")
    Page<Order> findByBranchIdAndStatusIn(
            @Param("branchId") UUID branchId,
            @Param("statuses") Collection<OrderStatus> statuses,
            Pageable pageable);
}
