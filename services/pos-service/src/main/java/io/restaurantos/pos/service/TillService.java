package io.restaurantos.pos.service;

import io.restaurantos.pos.dto.CloseTillRequest;
import io.restaurantos.pos.dto.OpenTillRequest;
import io.restaurantos.pos.dto.TillReconciliationDto;
import io.restaurantos.pos.dto.TillSessionDto;

import java.util.List;
import java.util.UUID;

public interface TillService {

    TillSessionDto openTill(OpenTillRequest request);

    TillSessionDto closeTill(UUID tillId, CloseTillRequest request);

    TillSessionDto getTill(UUID tillId);

    /**
     * Cashier-scoped till lookup (at most one row — a cashier has one till per status).
     * A {@code null} cashierId means "the caller's own"; a cashierId belonging to anyone else is
     * refused with {@code PermissionDeniedException} unless the caller holds {@code pos.till.review}.
     * {@code status} defaults to {@code OPEN}.
     */
    List<TillSessionDto> listTills(UUID cashierId, String status);

    /** Branch-wide till history for admin review (newest first). */
    List<TillSessionDto> listTillsForBranch(UUID branchId);

    /** A till session plus every order within it and the cash/non-cash it collected. */
    TillReconciliationDto getReconciliation(UUID tillId);
}
