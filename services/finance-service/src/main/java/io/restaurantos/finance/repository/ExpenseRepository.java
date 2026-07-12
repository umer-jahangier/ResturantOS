package io.restaurantos.finance.repository;

import io.restaurantos.finance.domain.enums.ExpenseStatus;
import io.restaurantos.finance.domain.model.Expense;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

@Repository
public interface ExpenseRepository extends JpaRepository<Expense, UUID> {

    /** PUR list endpoint (10-10): branch listing, newest first, no status filter. */
    List<Expense> findByTenantIdAndBranchIdOrderByExpenseDateDesc(UUID tenantId, UUID branchId);

    /** PUR list endpoint (10-10): branch listing narrowed by status. */
    List<Expense> findByTenantIdAndBranchIdAndStatusInOrderByExpenseDateDesc(
            UUID tenantId, UUID branchId, Collection<ExpenseStatus> statuses);
}
