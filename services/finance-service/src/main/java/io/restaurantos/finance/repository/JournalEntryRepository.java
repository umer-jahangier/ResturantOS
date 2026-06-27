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

    Page<JournalEntry> findByPeriodId(UUID periodId, Pageable pageable);

    Page<JournalEntry> findByStatus(JeStatus status, Pageable pageable);

    Page<JournalEntry> findByEntryDateBetween(LocalDate from, LocalDate to, Pageable pageable);

    Optional<JournalEntry> findByEntryNo(String entryNo);
}
