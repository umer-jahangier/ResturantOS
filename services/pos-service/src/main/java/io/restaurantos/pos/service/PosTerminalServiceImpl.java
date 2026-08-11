package io.restaurantos.pos.service;

import io.restaurantos.pos.authz.PosAuthorizationService;
import io.restaurantos.pos.domain.model.PosTerminal;
import io.restaurantos.pos.domain.model.PosTerminalCategory;
import io.restaurantos.pos.domain.model.PosTerminalStation;
import io.restaurantos.pos.dto.CreatePosTerminalRequest;
import io.restaurantos.pos.dto.PosTerminalDto;
import io.restaurantos.pos.dto.UpdatePosTerminalRequest;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.PosTerminalCategoryRepository;
import io.restaurantos.pos.repository.PosTerminalRepository;
import io.restaurantos.pos.repository.PosTerminalStationRepository;
import io.restaurantos.pos.repository.StationRepository;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.exception.StateInvalidException;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@Service
public class PosTerminalServiceImpl implements PosTerminalService {

    private final PosTerminalRepository terminalRepository;
    private final PosTerminalCategoryRepository categoryScopeRepository;
    private final PosTerminalStationRepository stationScopeRepository;
    private final MenuCategoryRepository menuCategoryRepository;
    private final StationRepository stationRepository;
    private final TenantContext tenantContext;
    private final PosAuthorizationService posAuthorizationService;

    public PosTerminalServiceImpl(PosTerminalRepository terminalRepository,
                                  PosTerminalCategoryRepository categoryScopeRepository,
                                  PosTerminalStationRepository stationScopeRepository,
                                  MenuCategoryRepository menuCategoryRepository,
                                  StationRepository stationRepository,
                                  TenantContext tenantContext,
                                  PosAuthorizationService posAuthorizationService) {
        this.terminalRepository = terminalRepository;
        this.categoryScopeRepository = categoryScopeRepository;
        this.stationScopeRepository = stationScopeRepository;
        this.menuCategoryRepository = menuCategoryRepository;
        this.stationRepository = stationRepository;
        this.tenantContext = tenantContext;
        this.posAuthorizationService = posAuthorizationService;
    }

    @Override
    @Transactional(readOnly = true)
    public List<PosTerminalDto> list(UUID branchId, boolean includeInactive) {
        requireOwnBranch(branchId);
        UUID tenantId = tenantContext.requireTenantId();
        List<PosTerminal> terminals;
        if (includeInactive) {
            // Gated HERE, not with a method-level @PreAuthorize on the controller. Phase 19b hit
            // this exactly: the annotation would have to be the WEAKER of the two permissions for
            // the ordinary read to keep working for a cashier's terminal picker, which would leave
            // the includeInactive flag itself as an unguarded escalation — a caller who may list
            // terminals could list retired ones by flipping a query parameter.
            posAuthorizationService.requireTerminalsAdmin();
            terminals = terminalRepository.findByTenantIdAndBranchIdOrderByCodeAsc(tenantId, branchId);
        } else {
            terminals = terminalRepository.findByTenantIdAndBranchIdAndActiveTrueOrderByCodeAsc(tenantId, branchId);
        }
        return terminals.stream().map(t -> toDto(tenantId, t)).toList();
    }

    @Override
    @Transactional(readOnly = true)
    public PosTerminalDto get(UUID id, UUID branchId) {
        requireOwnBranch(branchId);
        UUID tenantId = tenantContext.requireTenantId();
        return toDto(tenantId, requireTerminal(id, tenantId, branchId));
    }

    @Override
    @Transactional
    public PosTerminalDto create(UUID branchId, CreatePosTerminalRequest request) {
        posAuthorizationService.requireTerminalsAdmin();
        requireOwnBranch(branchId);
        UUID tenantId = tenantContext.requireTenantId();

        // A clean 409 rather than surfacing the constraint violation. The database constraint
        // still backstops a race between two concurrent creates — this check is the readable
        // answer, not the guarantee.
        terminalRepository.findByTenantIdAndBranchIdAndCode(tenantId, branchId, request.code())
                .ifPresent(t -> {
                    throw new StateInvalidException(
                            "Terminal code already exists for this branch: " + request.code());
                });

        PosTerminal terminal = new PosTerminal();
        terminal.setTenantId(tenantId);
        terminal.setBranchId(branchId);
        terminal.setCode(request.code());
        terminal.setName(request.name());
        terminal.setServiceModel(request.serviceModelOrDefault());
        terminal.setDefaultOrderType(request.defaultOrderType());
        terminal.setPrinterRef(request.printerRef());
        terminal.setActive(true);
        PosTerminal saved = terminalRepository.save(terminal);

        replaceCategoryScope(tenantId, saved.getId(), request.categoryIdsOrEmpty());
        replaceStationScope(tenantId, branchId, saved.getId(), request.stationIdsOrEmpty());

        return toDto(tenantId, saved);
    }

    @Override
    @Transactional
    public PosTerminalDto update(UUID id, UUID branchId, UpdatePosTerminalRequest request) {
        posAuthorizationService.requireTerminalsAdmin();
        requireOwnBranch(branchId);
        UUID tenantId = tenantContext.requireTenantId();
        PosTerminal terminal = requireTerminal(id, tenantId, branchId);

        terminal.setName(request.name());
        if (request.serviceModel() != null) {
            terminal.setServiceModel(request.serviceModel());
        }
        terminal.setDefaultOrderType(request.defaultOrderType());
        terminal.setPrinterRef(request.printerRef());
        // The code is deliberately absent from the update request and is not settable here. A
        // device remembers which terminal it is by that handle; renaming it would silently
        // re-point every screen that stored it. Same reasoning as a station's code.
        terminalRepository.save(terminal);

        // null means "leave this scope alone"; an empty list means "offer everything". Both
        // spellings are required — an update that only renames must not silently widen the
        // terminal's menu to the whole card.
        if (request.categoryIds() != null) {
            replaceCategoryScope(tenantId, id, request.categoryIds());
        }
        if (request.stationIds() != null) {
            replaceStationScope(tenantId, branchId, id, request.stationIds());
        }

        return toDto(tenantId, terminal);
    }

    @Override
    @Transactional
    public PosTerminalDto deactivate(UUID id, UUID branchId) {
        posAuthorizationService.requireTerminalsAdmin();
        requireOwnBranch(branchId);
        UUID tenantId = tenantContext.requireTenantId();
        PosTerminal terminal = requireTerminal(id, tenantId, branchId);
        terminal.setActive(false);
        return toDto(tenantId, terminalRepository.save(terminal));
    }

    @Override
    @Transactional
    public PosTerminalDto reactivate(UUID id, UUID branchId) {
        posAuthorizationService.requireTerminalsAdmin();
        requireOwnBranch(branchId);
        UUID tenantId = tenantContext.requireTenantId();
        PosTerminal terminal = requireTerminal(id, tenantId, branchId);
        terminal.setActive(true);
        return toDto(tenantId, terminalRepository.save(terminal));
    }

    // ── Scope replacement ────────────────────────────────────────────────────────────────────

    /**
     * Set the terminal's offered categories to exactly this set.
     *
     * <p><b>Every id is validated before any row is written.</b> A partial application that accepts
     * three categories and rejects the fourth leaves the administrator looking at a screen that
     * disagrees with the database, and no error message can repair that — they submitted one
     * intention and got half of it.
     *
     * <p>An empty set is legitimate and is how a terminal is returned to offering the whole menu.
     */
    private void replaceCategoryScope(UUID tenantId, UUID terminalId, List<UUID> categoryIds) {
        Set<UUID> wanted = new LinkedHashSet<>(categoryIds);
        for (UUID categoryId : wanted) {
            menuCategoryRepository.findByIdAndTenantId(categoryId, tenantId)
                    .orElseThrow(() -> new ResourceNotFoundException(
                            "Menu category not found in this tenant: " + categoryId));
        }
        categoryScopeRepository.deleteByTenantIdAndTerminalId(tenantId, terminalId);
        categoryScopeRepository.flush();
        for (UUID categoryId : wanted) {
            PosTerminalCategory row = new PosTerminalCategory();
            row.setTenantId(tenantId);
            row.setTerminalId(terminalId);
            row.setCategoryId(categoryId);
            categoryScopeRepository.save(row);
        }
    }

    /**
     * Set the terminal's fire-to stations to exactly this set.
     *
     * <p>Stations are validated inside the caller's BRANCH, not merely the tenant. A station code
     * only means something within a branch, and a terminal firing to another branch's grill would
     * send tickets to a kitchen in another building.
     */
    private void replaceStationScope(UUID tenantId, UUID branchId, UUID terminalId, List<UUID> stationIds) {
        Set<UUID> wanted = new LinkedHashSet<>(stationIds);
        for (UUID stationId : wanted) {
            stationRepository.findByIdAndTenantIdAndBranchId(stationId, tenantId, branchId)
                    .orElseThrow(() -> new ResourceNotFoundException(
                            "Station not found in this branch: " + stationId));
        }
        stationScopeRepository.deleteByTenantIdAndTerminalId(tenantId, terminalId);
        stationScopeRepository.flush();
        for (UUID stationId : wanted) {
            PosTerminalStation row = new PosTerminalStation();
            row.setTenantId(tenantId);
            row.setTerminalId(terminalId);
            row.setStationId(stationId);
            stationScopeRepository.save(row);
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────

    private PosTerminalDto toDto(UUID tenantId, PosTerminal terminal) {
        List<UUID> categoryIds = categoryScopeRepository
                .findByTenantIdAndTerminalId(tenantId, terminal.getId()).stream()
                .map(PosTerminalCategory::getCategoryId)
                .toList();
        List<UUID> stationIds = stationScopeRepository
                .findByTenantIdAndTerminalId(tenantId, terminal.getId()).stream()
                .map(PosTerminalStation::getStationId)
                .toList();
        return PosTerminalDto.from(terminal, categoryIds, stationIds);
    }

    private PosTerminal requireTerminal(UUID id, UUID tenantId, UUID branchId) {
        return terminalRepository.findByIdAndTenantIdAndBranchId(id, tenantId, branchId)
                .orElseThrow(() -> new ResourceNotFoundException("Terminal not found: " + id));
    }

    /**
     * Defense-in-depth against a client-supplied {@code branchId} that widens scope beyond the
     * caller's JWT branch. Mirrors {@code StationServiceImpl.requireOwnBranch} and
     * {@code TableServiceImpl.requireOwnBranch} — one shape for this in this service, not three.
     */
    private void requireOwnBranch(UUID branchId) {
        UUID jwtBranchId = tenantContext.getBranchId()
                .orElseThrow(() -> new PermissionDeniedException("Branch context required"));
        if (!jwtBranchId.equals(branchId)) {
            throw new PermissionDeniedException("Cannot access terminals for a different branch");
        }
    }
}
