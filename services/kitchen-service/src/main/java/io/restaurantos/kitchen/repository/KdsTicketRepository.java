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

import java.time.Instant;
import java.util.Collection;
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

    // Branch-wide, station-agnostic board query (kitchen main-screen station stats). Must
    // eager-fetch items (toDto walks them after the session closes) and be scoped to branchId +
    // status — the previous no-station path used findAll(pageable), which ignored branchId
    // (cross-tenant leak), ignored the status filter, and threw LazyInitializationException.
    @EntityGraph(attributePaths = "items")
    Page<KdsTicket> findByBranchIdAndStatusIn(
            UUID branchId, List<TicketStatus> statuses, Pageable pageable);

    /**
     * The branch-wide board, narrowed to the stations this caller actually works (28-07, D-28-02).
     *
     * <p>The station predicate is ADDED to the branch and status predicates, never substituted for
     * them. Dropping the branch predicate while adding a station one would widen the board across
     * branches — a strictly worse bug than the one being fixed, and one that would look like a
     * feature until somebody noticed another restaurant's tickets on their screen.
     *
     * <p>Never called with an empty code set. {@code StationScope.permittedCodes()} throws for an
     * unrestricted scope precisely so this cannot be reached with an empty {@code IN} clause, which
     * would return nothing and black out the board.
     */
    @EntityGraph(attributePaths = "items")
    Page<KdsTicket> findByBranchIdAndStationCodeInAndStatusIn(
            UUID branchId, Collection<String> stationCodes, List<TicketStatus> statuses, Pageable pageable);

    @Query("SELECT COUNT(t) FROM KdsTicket t WHERE t.orderId = :orderId AND t.status <> :excludedStatus")
    long countByOrderIdAndStatusNot(@Param("orderId") UUID orderId, @Param("excludedStatus") TicketStatus excludedStatus);

    /**
     * Every ACTIVE ticket at this branch whose {@code receivedAt} falls before {@code cutoff} —
     * the tickets belonging to a business day that has already closed (F17).
     *
     * <p><b>{@code receivedAt <} and never {@code <=}.</b> {@code cutoff} is the exact instant the
     * CURRENT business day began, so a ticket fired at that instant is today's work. Strict less-than
     * is what makes "no ticket from the current business day is removed" a property of the query
     * rather than of the caller remembering.
     *
     * <p>Ordered oldest first: the confirmation has to be able to say how old the oldest one is, and
     * a cook reading the list wants yesterday's head of queue at the top.
     *
     * <p>Items are eager-fetched because the summary counts live lines per ticket and the caller maps
     * to DTOs after the session closes — the LazyInitializationException class of bug this repository
     * has hit before.
     */
    @EntityGraph(attributePaths = "items")
    @Query("""
            SELECT t FROM KdsTicket t
            WHERE t.branchId = :branchId
              AND t.status IN :statuses
              AND t.receivedAt < :cutoff
            ORDER BY t.receivedAt ASC
            """)
    List<KdsTicket> findStaleByBranch(@Param("branchId") UUID branchId,
                                      @Param("statuses") Collection<TicketStatus> statuses,
                                      @Param("cutoff") Instant cutoff);

    /** {@link #findStaleByBranch} narrowed to one station — the per-board control. */
    @EntityGraph(attributePaths = "items")
    @Query("""
            SELECT t FROM KdsTicket t
            WHERE t.branchId = :branchId
              AND t.stationCode = :stationCode
              AND t.status IN :statuses
              AND t.receivedAt < :cutoff
            ORDER BY t.receivedAt ASC
            """)
    List<KdsTicket> findStaleByBranchAndStation(@Param("branchId") UUID branchId,
                                                @Param("stationCode") String stationCode,
                                                @Param("statuses") Collection<TicketStatus> statuses,
                                                @Param("cutoff") Instant cutoff);

    // Ticket-detail read (KDS-03 "open a ticket for full order detail"): items must be
    // fetched eagerly here, same rationale as findByBranchIdAndStationCodeAndStatusIn above —
    // avoids the LazyInitializationException class of bug from the Phase-7 UAT.
    @EntityGraph(attributePaths = "items")
    @Query("SELECT t FROM KdsTicket t WHERE t.id = :id")
    Optional<KdsTicket> findDetailById(@Param("id") UUID id);
}
