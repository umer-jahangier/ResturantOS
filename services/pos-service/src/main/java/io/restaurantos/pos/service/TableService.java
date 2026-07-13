package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.enums.DerivedOrderStatus;
import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.TableStatus;
import io.restaurantos.pos.domain.model.DiningTable;
import io.restaurantos.pos.dto.TableDetailDto;

import java.util.List;
import java.util.UUID;

public interface TableService {
    List<DiningTable> listByBranch(UUID branchId);
    DiningTable updateStatus(UUID tableId, UUID branchId, TableStatus status);

    /**
     * Table→active-order lookup (POS-10): the table's own fields + its at-most-one
     * non-terminal order (or {@code null}) + a live bill summary. {@code branchId} MUST be
     * the caller's JWT branch — never a client-supplied value that could widen scope.
     */
    TableDetailDto getActiveOrderForTable(UUID tableId, UUID branchId);

    /**
     * Single seam for deriving a table's status from its bound order's lifecycle
     * (RESEARCH.md Pitfall 5: table state is itself partially derived from order state).
     * AVAILABLE when the order reaches a terminal (CLOSED/VOIDED/REFUNDED) status,
     * NEEDS_BUSSING when the order's derivedStatus reaches SERVED (but the order itself is
     * not yet terminal), OCCUPIED otherwise. No-op if {@code tableId} is null (take-away/
     * non-table orders) or the table can't be found for the given branch.
     */
    void syncStatusForOrder(UUID tableId, UUID branchId, OrderStatus orderStatus, DerivedOrderStatus derivedStatus);
}
