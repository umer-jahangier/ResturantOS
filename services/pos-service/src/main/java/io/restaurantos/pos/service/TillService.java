package io.restaurantos.pos.service;

import io.restaurantos.pos.dto.CloseTillRequest;
import io.restaurantos.pos.dto.OpenTillRequest;
import io.restaurantos.pos.dto.TillReconciliationDto;
import io.restaurantos.pos.dto.TillSessionDto;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.util.List;
import java.util.UUID;

public interface TillService {

    TillSessionDto openTill(OpenTillRequest request);

    TillSessionDto closeTill(UUID tillId, CloseTillRequest request);

    TillSessionDto getTill(UUID tillId);

    List<TillSessionDto> listTills(UUID cashierId, String status);

    /** Branch-wide till history for admin review (newest first), paginated. */
    Page<TillSessionDto> listTillsForBranch(UUID branchId, Pageable pageable);

    /** A till session plus every order within it and the cash/non-cash it collected. */
    TillReconciliationDto getReconciliation(UUID tillId);
}
