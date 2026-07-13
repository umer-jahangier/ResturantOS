package io.restaurantos.kitchen.repository;

import io.restaurantos.kitchen.domain.model.KdsTicketItem;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface KdsTicketItemRepository extends JpaRepository<KdsTicketItem, UUID> {

    List<KdsTicketItem> findByTicketId(UUID ticketId);

    /** Locate the KDS line mirroring a pos OrderItem — the ORDER_ITEM_CANCELLED consumer's key. */
    Optional<KdsTicketItem> findByOrderItemId(UUID orderItemId);

    // Counts items still to finish. CANCELLED lines are terminal (won't be cooked) so they must
    // be excluded too — otherwise a cancelled item would permanently block the ticket from
    // reaching READY.
    @Query("SELECT COUNT(i) FROM KdsTicketItem i WHERE i.ticket.id = :ticketId "
            + "AND i.status <> io.restaurantos.kitchen.domain.enums.TicketItemStatus.READY "
            + "AND i.status <> io.restaurantos.kitchen.domain.enums.TicketItemStatus.CANCELLED")
    long countByTicketIdAndStatusNotReady(@Param("ticketId") UUID ticketId);
}
