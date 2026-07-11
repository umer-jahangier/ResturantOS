package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.enums.DerivedOrderStatus;
import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.TableStatus;
import io.restaurantos.pos.domain.model.DiningTable;
import io.restaurantos.pos.domain.model.Order;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.dto.TableDetailDto;
import io.restaurantos.pos.repository.DiningTableRepository;
import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.EnumSet;
import java.util.List;
import java.util.Optional;
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

    public TableServiceImpl(DiningTableRepository tableRepository,
                            OrderRepository orderRepository,
                            OrderMapper orderMapper,
                            TenantContext tenantContext) {
        this.tableRepository = tableRepository;
        this.orderRepository = orderRepository;
        this.orderMapper = orderMapper;
        this.tenantContext = tenantContext;
    }

    @Override
    @Transactional(readOnly = true)
    public List<DiningTable> listByBranch(UUID branchId) {
        return tableRepository.findByBranchId(branchId);
    }

    @Override
    @Transactional
    public DiningTable updateStatus(UUID tableId, UUID branchId, TableStatus status) {
        DiningTable table = tableRepository.findByIdAndBranchId(tableId, branchId)
                .orElseThrow(() -> new ResourceNotFoundException("Dining table not found: " + tableId));
        table.setStatus(status);
        return tableRepository.save(table);
    }

    @Override
    @Transactional(readOnly = true)
    public TableDetailDto getActiveOrderForTable(UUID tableId, UUID branchId) {
        requireOwnBranch(branchId);

        DiningTable table = tableRepository.findByIdAndBranchId(tableId, branchId)
                .orElseThrow(() -> new ResourceNotFoundException("Dining table not found: " + tableId));

        Optional<Order> activeOrder = orderRepository.findByTableIdAndStatusNotIn(tableId, TERMINAL_ORDER_STATUSES);
        OrderDto orderDto = activeOrder.map(orderMapper::toDto).orElse(null);

        return TableDetailDto.from(table, orderDto);
    }

    @Override
    @Transactional
    public void syncStatusForOrder(UUID tableId, UUID branchId, OrderStatus orderStatus, DerivedOrderStatus derivedStatus) {
        if (tableId == null) {
            return;
        }
        tableRepository.findByIdAndBranchId(tableId, branchId).ifPresent(table -> {
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
