package io.restaurantos.pos.service;

import io.restaurantos.pos.dto.CreatePosTerminalRequest;
import io.restaurantos.pos.dto.PosTerminalDto;
import io.restaurantos.pos.dto.UpdatePosTerminalRequest;

import java.util.List;
import java.util.UUID;

/**
 * Admin CRUD for POS terminal profiles (28-04, D-28-03). Every method is tenant + branch scoped and
 * guarded by {@code requireOwnBranch} — a client-supplied branchId must equal the caller's verified
 * JWT branch, the same shape stations and dining tables already use.
 *
 * <p><b>There is no delete, and there will not be one.</b> See
 * {@link #deactivate(UUID, UUID)}.
 */
public interface PosTerminalService {

    /**
     * The branch's terminals.
     *
     * @param includeInactive show retired terminals too — an ADMIN capability, gated inside the
     *                        implementation rather than by a controller annotation. See the
     *                        implementation for why the annotation form is an escalation.
     */
    List<PosTerminalDto> list(UUID branchId, boolean includeInactive);

    PosTerminalDto get(UUID id, UUID branchId);

    PosTerminalDto create(UUID branchId, CreatePosTerminalRequest request);

    PosTerminalDto update(UUID id, UUID branchId, UpdatePosTerminalRequest request);

    /**
     * Retire a terminal. Never a hard delete: from plan 28-12 {@code orders.terminal_id} references
     * these rows, and a closed order must keep naming the terminal it was taken on.
     */
    PosTerminalDto deactivate(UUID id, UUID branchId);

    PosTerminalDto reactivate(UUID id, UUID branchId);
}
