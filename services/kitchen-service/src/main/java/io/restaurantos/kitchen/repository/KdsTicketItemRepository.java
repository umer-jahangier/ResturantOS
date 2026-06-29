package io.restaurantos.kitchen.repository;

import io.restaurantos.kitchen.domain.model.KdsTicketItem;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface KdsTicketItemRepository extends JpaRepository<KdsTicketItem, UUID> {

    List<KdsTicketItem> findByTicketId(UUID ticketId);

    @Query("SELECT COUNT(i) FROM KdsTicketItem i WHERE i.ticket.id = :ticketId AND i.status <> io.restaurantos.kitchen.domain.enums.TicketItemStatus.READY")
    long countByTicketIdAndStatusNotReady(@Param("ticketId") UUID ticketId);
}
