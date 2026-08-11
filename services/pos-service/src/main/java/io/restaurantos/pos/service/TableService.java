package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.enums.DerivedOrderStatus;
import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.TableStatus;
import io.restaurantos.pos.domain.model.DiningTable;
import io.restaurantos.pos.dto.TableAdminDtos.CreateDiningTableRequest;
import io.restaurantos.pos.dto.TableAdminDtos.UpdateDiningTableRequest;
import io.restaurantos.pos.dto.TableDetailDto;

import java.util.List;
import java.util.UUID;

public interface TableService {

    /**
     * @param includeInactive {@code false} (the service-time picker) returns only tables still
     *                        in service. {@code true} (the management screen) includes retired
     *                        ones so they can be found and reactivated, and therefore requires
     *                        {@code pos.tables.admin} — a waiter holding {@code pos.order.view}
     *                        gets the catalogue refused, not silently widened.
     */
    List<DiningTable> listByBranch(UUID branchId, boolean includeInactive);

    DiningTable updateStatus(UUID tableId, UUID branchId, TableStatus status);

    // ── Catalogue administration (pos.tables.admin) ─────────────────────────────────────────

    /** Creates a table in the caller's own branch. Rejects a duplicate table number. */
    DiningTable create(UUID branchId, CreateDiningTableRequest request);

    /** Renames / re-capacities / re-sections an existing table. Cannot move it between branches. */
    DiningTable update(UUID tableId, UUID branchId, UpdateDiningTableRequest request);

    /**
     * Retire or restore a table. Never a delete: {@code orders.table_id} references these rows
     * and a closed order must keep naming the table it was served at.
     */
    DiningTable setActive(UUID tableId, UUID branchId, boolean active);

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
