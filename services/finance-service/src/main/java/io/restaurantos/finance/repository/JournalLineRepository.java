package io.restaurantos.finance.repository;

import io.restaurantos.finance.domain.model.JournalLine;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface JournalLineRepository extends JpaRepository<JournalLine, UUID> {

    @Query("""
            SELECT l FROM JournalLine l
            WHERE l.accountCode = :accountCode
              AND l.journalEntry.period.id = :periodId
              AND l.journalEntry.branchId = :branchId
              AND l.journalEntry.status = 'POSTED'
            """)
    Page<JournalLine> findPostedByAccountCodeAndPeriodIdAndBranchId(
            @Param("accountCode") String accountCode,
            @Param("periodId") UUID periodId,
            @Param("branchId") UUID branchId,
            Pageable pageable);

    @Query("""
            SELECT l.accountCode, SUM(l.debitPaisa), SUM(l.creditPaisa)
            FROM JournalLine l
            JOIN l.journalEntry je
            WHERE je.period.id = :periodId
              AND je.branchId = :branchId
              AND je.status = 'POSTED'
            GROUP BY l.accountCode
            ORDER BY l.accountCode
            """)
    List<Object[]> findGlBalancesRaw(
            @Param("periodId") UUID periodId,
            @Param("branchId") UUID branchId);

    @Query("""
            SELECT l FROM JournalLine l
            JOIN FETCH l.journalEntry je
            WHERE l.accountCode = :accountCode
              AND je.branchId = :branchId
              AND je.status = 'POSTED'
            """)
    List<JournalLine> findPostedApLines(
            @Param("accountCode") String accountCode,
            @Param("branchId") UUID branchId);
}
