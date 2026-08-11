package io.restaurantos.finance.repository;

import io.restaurantos.finance.domain.enums.JeStatus;
import io.restaurantos.finance.domain.model.JournalEntry;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface JournalEntryRepository extends JpaRepository<JournalEntry, UUID> {

    Page<JournalEntry> findByPeriodIdAndBranchId(UUID periodId, UUID branchId, Pageable pageable);

    Page<JournalEntry> findByEntryDateBetweenAndBranchId(
            LocalDate from, LocalDate to, UUID branchId, Pageable pageable);

    Optional<JournalEntry> findByEntryNo(String entryNo);

    Optional<JournalEntry> findByTenantIdAndSourceTypeAndSourceId(
            UUID tenantId, String sourceType, UUID sourceId);

    /**
     * EVERY entry a source produced, not just the first one (37-04, D-37-01).
     *
     * <p>Deliberately keyed on {@code sourceId} ALONE. A single closed order posts up to three
     * entries under three different {@code source_type}s — {@code ORDER_REVENUE} on close,
     * {@code ORDER_COGS} when inventory depletes, {@code ORDER_REFUND} later — by three different
     * consumers at three different times, all sharing one {@code source_id}. Querying by the
     * {@code (sourceType, sourceId)} PAIR returns exactly one of them, because
     * {@code posted_source_events} is unique on that pair. That is a plausible partial answer,
     * which is worse than no answer: it looks complete.
     *
     * <p>Verified against live data before this method was written — orders
     * {@code 0dc09465…} and {@code fffecf0a…} carry ORDER_COGS + ORDER_REVENUE, and
     * {@code cc69fb6e…} carries ORDER_REFUND + ORDER_REVENUE.
     *
     * <p>Tenant scoping comes from the FORCE RLS policy on this table, not from this method
     * signature — the caller cannot ask for another tenant's rows because there is no parameter
     * with which to ask.
     *
     * <p>Ordering is deterministic (date, then entry number) so a screen and a test agree.
     */
    @Query("SELECT je FROM JournalEntry je WHERE je.sourceId = :sourceId "
            + "ORDER BY je.entryDate ASC, je.entryNo ASC")
    List<JournalEntry> findAllBySourceId(@Param("sourceId") UUID sourceId);

    /** As {@link #findAllBySourceId}, narrowed to one source type when the caller wants just one. */
    @Query("SELECT je FROM JournalEntry je WHERE je.sourceId = :sourceId "
            + "AND je.sourceType = :sourceType ORDER BY je.entryDate ASC, je.entryNo ASC")
    List<JournalEntry> findAllBySourceIdAndSourceType(@Param("sourceId") UUID sourceId,
                                                      @Param("sourceType") String sourceType);
}
