package io.restaurantos.pos.service;

import io.restaurantos.pos.authz.PosAuthorizationService;
import io.restaurantos.pos.domain.enums.DerivedOrderStatus;
import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.TableStatus;
import io.restaurantos.pos.domain.model.DiningTable;
import io.restaurantos.pos.domain.model.Order;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.dto.TableAdminDtos.CreateDiningTableRequest;
import io.restaurantos.pos.dto.TableAdminDtos.UpdateDiningTableRequest;
import io.restaurantos.pos.dto.TableDetailDto;
import io.restaurantos.pos.repository.DiningTableRepository;
import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.exception.StateInvalidException;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@Service
public class TableServiceImpl implements TableService {

    private static final Set<OrderStatus> TERMINAL_ORDER_STATUSES =
            EnumSet.of(OrderStatus.CLOSED, OrderStatus.VOIDED, OrderStatus.REFUNDED);

    private final DiningTableRepository tableRepository;
    private final OrderRepository orderRepository;
    private final OrderMapper orderMapper;
    private final TenantContext tenantContext;
    private final PosAuthorizationService posAuthorizationService;

    public TableServiceImpl(DiningTableRepository tableRepository,
                            OrderRepository orderRepository,
                            OrderMapper orderMapper,
                            TenantContext tenantContext,
                            PosAuthorizationService posAuthorizationService) {
        this.tableRepository = tableRepository;
        this.orderRepository = orderRepository;
        this.orderMapper = orderMapper;
        this.tenantContext = tenantContext;
        this.posAuthorizationService = posAuthorizationService;
    }

    @Override
    @Transactional(readOnly = true)
    public List<DiningTable> listByBranch(UUID branchId, boolean includeInactive) {
        requireOwnBranch(branchId);
        UUID tenantId = tenantContext.requireTenantId();
        if (includeInactive) {
            // The catalogue view is an admin capability, not a wider read of the same list —
            // gate it here rather than on the controller, because the controller's method-level
            // @PreAuthorize would have to be the WEAKER of the two permissions to keep the
            // waiter's picker working, and then the flag would be an unguarded escalation.
            posAuthorizationService.requireTablesAdmin();
            return tableRepository.findAllByTenantAndBranch(tenantId, branchId);
        }
        return tableRepository.findActiveByTenantAndBranch(tenantId, branchId);
    }

    @Override
    @Transactional
    public DiningTable updateStatus(UUID tableId, UUID branchId, TableStatus status) {
        // SECURITY (branch isolation): a client-supplied branchId must not let a caller mutate a
        // table's status in another branch within the same tenant.
        requireOwnBranch(branchId);
        DiningTable table = requireTable(tableId, branchId);
        // Seating a retired table would resurrect it in every status-driven view while leaving
        // it absent from the catalogue — refuse rather than produce that contradiction.
        if (!table.isActive()) {
            throw new StateInvalidException("Table is no longer in service: " + table.getTableNumber());
        }
        table.setStatus(status);
        return tableRepository.save(table);
    }

    // ── Catalogue administration ────────────────────────────────────────────────────────────

    @Override
    @Transactional
    public DiningTable create(UUID branchId, CreateDiningTableRequest request) {
        posAuthorizationService.requireTablesAdmin();
        requireOwnBranch(branchId);
        UUID tenantId = tenantContext.requireTenantId();

        String tableNumber = request.tableNumber().trim();
        requireUniqueTableNumber(tenantId, branchId, tableNumber, null);

        DiningTable table = new DiningTable();
        table.setTenantId(tenantId);
        // Branch comes from the VERIFIED JWT branch (requireOwnBranch above proved the supplied
        // value equals it), never from the request body — there is no wire shape that lets a
        // caller create a table in a branch they are not signed in to.
        table.setBranchId(branchId);
        table.setTableNumber(tableNumber);
        table.setCapacity(request.capacity());
        table.setSection(normalizeSection(request.section()));
        table.setActive(true);
        table.setStatus(TableStatus.AVAILABLE);
        return tableRepository.save(table);
    }

    @Override
    @Transactional
    public DiningTable update(UUID tableId, UUID branchId, UpdateDiningTableRequest request) {
        posAuthorizationService.requireTablesAdmin();
        requireOwnBranch(branchId);
        UUID tenantId = tenantContext.requireTenantId();

        DiningTable table = requireTable(tableId, branchId);
        String tableNumber = request.tableNumber().trim();
        requireUniqueTableNumber(tenantId, branchId, tableNumber, tableId);

        table.setTableNumber(tableNumber);
        table.setCapacity(request.capacity());
        table.setSection(normalizeSection(request.section()));
        // Deliberately does NOT touch status or active: renaming a table mid-service must not
        // clear the party sitting at it, and activate/deactivate own their own endpoints.
        return tableRepository.save(table);
    }

    @Override
    @Transactional
    public DiningTable setActive(UUID tableId, UUID branchId, boolean active) {
        posAuthorizationService.requireTablesAdmin();
        requireOwnBranch(branchId);
        DiningTable table = requireTable(tableId, branchId);

        // Retiring a table that is mid-service would strand the party sitting at it: the order
        // stays open and bound, but the table vanishes from every picker and floor view, so
        // nobody can find the bill. Refuse and say which state to clear first.
        if (!active && table.getStatus() != TableStatus.AVAILABLE) {
            throw new StateInvalidException(
                    "Table " + table.getTableNumber() + " is " + table.getStatus()
                            + " — close or move its order before retiring it.");
        }

        table.setActive(active);
        return tableRepository.save(table);
    }

    // ── Reads ───────────────────────────────────────────────────────────────────────────────

    @Override
    @Transactional(readOnly = true)
    public TableDetailDto getActiveOrderForTable(UUID tableId, UUID branchId) {
        requireOwnBranch(branchId);

        DiningTable table = requireTable(tableId, branchId);

        OrderDto orderDto = orderRepository.findActiveByTableId(tableId, TERMINAL_ORDER_STATUSES, Limit.of(1))
                .stream().findFirst().map(orderMapper::toDto).orElse(null);

        return TableDetailDto.from(table, orderDto);
    }

    @Override
    @Transactional
    public void syncStatusForOrder(UUID tableId, UUID branchId, OrderStatus orderStatus, DerivedOrderStatus derivedStatus) {
        if (tableId == null) {
            return;
        }
        UUID tenantId = tenantContext.requireTenantId();
        // Intentionally NOT filtered on is_active. This seam runs on every order transition,
        // including the CLOSED transition of an order that was already open when its table was
        // retired — skipping it there would leave that table stuck OCCUPIED forever.
        tableRepository.findByIdTenantAndBranch(tableId, tenantId, branchId).ifPresent(table -> {
            TableStatus newStatus;
            if (TERMINAL_ORDER_STATUSES.contains(orderStatus)) {
                newStatus = TableStatus.AVAILABLE;
            } else if (derivedStatus == DerivedOrderStatus.SERVED) {
                newStatus = TableStatus.NEEDS_BUSSING;
            } else {
                newStatus = TableStatus.OCCUPIED;
            }
            table.setStatus(newStatus);
        });
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────────────────

    private DiningTable requireTable(UUID tableId, UUID branchId) {
        return tableRepository
                .findByIdTenantAndBranch(tableId, tenantContext.requireTenantId(), branchId)
                .orElseThrow(() -> new ResourceNotFoundException("Dining table not found: " + tableId));
    }

    /**
     * The database owns the real guarantee (unique on tenant+branch+table_number). This exists
     * so the manager reads a sentence instead of a constraint-violation 500 — and it points at
     * reactivation, because a RETIRED table still holds its number and is the overwhelmingly
     * likely reason a "new" one collides.
     */
    private void requireUniqueTableNumber(UUID tenantId, UUID branchId, String tableNumber, UUID excludeId) {
        if (tableRepository.existsByTableNumber(tenantId, branchId, tableNumber, excludeId)) {
            throw new StateInvalidException(
                    "A table named \"" + tableNumber + "\" already exists in this branch. "
                            + "If it was retired, reactivate it instead of creating a second one.");
        }
    }

    /** Blank and absent mean the same thing for a free-text label; store NULL for both. */
    private String normalizeSection(String section) {
        if (section == null || section.isBlank()) {
            return null;
        }
        return section.trim();
    }

    /**
     * Defense-in-depth against a client-supplied {@code branchId} that widens scope beyond
     * the caller's JWT branch (T-07.1d-02) — {@code branchId} is still accepted as an explicit
     * request parameter (matching the rest of this controller's existing convention), but it
     * must always equal the tenant-context branch derived from the verified JWT.
     */
    private void requireOwnBranch(UUID branchId) {
        UUID jwtBranchId = tenantContext.getBranchId()
                .orElseThrow(() -> new PermissionDeniedException("Branch context required"));
        if (!jwtBranchId.equals(branchId)) {
            throw new PermissionDeniedException("Cannot access tables for a different branch");
        }
    }
}
