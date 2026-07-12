package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.enums.TableStatus;
import io.restaurantos.pos.domain.model.DiningTable;

import java.util.List;
import java.util.UUID;

public interface TableService {
    List<DiningTable> listByBranch(UUID branchId);
    DiningTable updateStatus(UUID tableId, UUID branchId, TableStatus status);
}
