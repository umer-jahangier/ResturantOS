package io.restaurantos.kitchen.repository;

import io.restaurantos.kitchen.domain.enums.TicketStatus;
import io.restaurantos.kitchen.domain.model.KdsTicket;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface KdsTicketRepository extends JpaRepository<KdsTicket, UUID> {

    List<KdsTicket> findByOrderId(UUID orderId);

    Optional<KdsTicket> findByOrderIdAndStationCode(UUID orderId, String stationCode);

    // toDto() walks ticket.items for every row in the page, so items must be
    // fetched eagerly here — the controller maps to DTOs after this repository
    // call's session has already closed.
    @EntityGraph(attributePaths = "items")
    Page<KdsTicket> findByBranchIdAndStationCodeAndStatusIn(
            UUID branchId, String stationCode, List<TicketStatus> statuses, Pageable pageable);

    @Query("SELECT COUNT(t) FROM KdsTicket t WHERE t.orderId = :orderId AND t.status <> :excludedStatus")
    long countByOrderIdAndStatusNot(@Param("orderId") UUID orderId, @Param("excludedStatus") TicketStatus excludedStatus);
}
