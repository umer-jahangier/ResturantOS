package io.restaurantos.finance.repository;

import io.restaurantos.finance.domain.enums.JeStatus;
import io.restaurantos.finance.domain.model.JournalEntry;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
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
}
