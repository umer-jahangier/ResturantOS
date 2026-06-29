package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.enums.TableStatus;
import io.restaurantos.pos.domain.model.DiningTable;
import io.restaurantos.pos.repository.DiningTableRepository;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class TableServiceImpl implements TableService {

    private final DiningTableRepository tableRepository;

    public TableServiceImpl(DiningTableRepository tableRepository) {
        this.tableRepository = tableRepository;
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
}
