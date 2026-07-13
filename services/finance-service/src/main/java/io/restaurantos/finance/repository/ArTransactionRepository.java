package io.restaurantos.finance.repository;

import io.restaurantos.finance.domain.model.ArTransaction;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface ArTransactionRepository extends JpaRepository<ArTransaction, UUID> {

    List<ArTransaction> findByCustomerAccountIdOrderByTxnDateAsc(UUID customerAccountId);

    /** Feeds ArAgingCalculator. */
    List<ArTransaction> findByTenantIdAndBranchId(UUID tenantId, UUID branchId);

    /** Idempotency read-back for the manual and internal charge paths. */
    Optional<ArTransaction> findByTenantIdAndSourceTypeAndSourceId(
            UUID tenantId, String sourceType, UUID sourceId);

    /** Balance = charges minus settlements, in paisa, for one customer account. */
    @Query("""
            SELECT COALESCE(SUM(CASE WHEN t.txnType = 'CHARGE' THEN t.amountPaisa ELSE -t.amountPaisa END), 0)
            FROM ArTransaction t
            WHERE t.tenantId = :tenantId AND t.customerAccountId = :customerAccountId
            """)
    long balanceForAccount(@Param("tenantId") UUID tenantId,
                            @Param("customerAccountId") UUID customerAccountId);
}
