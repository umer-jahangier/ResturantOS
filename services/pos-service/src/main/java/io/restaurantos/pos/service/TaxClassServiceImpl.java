package io.restaurantos.pos.service;

import io.restaurantos.pos.authz.PosAuthorizationService;
import io.restaurantos.pos.domain.model.TaxClass;
import io.restaurantos.pos.dto.TaxClassDtos.CreateTaxClassRequest;
import io.restaurantos.pos.dto.TaxClassDtos.TaxClassDto;
import io.restaurantos.pos.dto.TaxClassDtos.UpdateTaxClassRequest;
import io.restaurantos.pos.repository.TaxClassRepository;
import io.restaurantos.shared.exception.DuplicateValueException;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.exception.StateInvalidException;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
@Transactional(readOnly = true)
public class TaxClassServiceImpl implements TaxClassService {

    private final TaxClassRepository repository;
    private final TenantContext tenantContext;
    private final PosAuthorizationService authorization;

    public TaxClassServiceImpl(TaxClassRepository repository,
                               TenantContext tenantContext,
                               PosAuthorizationService authorization) {
        this.repository = repository;
        this.tenantContext = tenantContext;
        this.authorization = authorization;
    }

    /**
     * Read is gated on {@code pos.menu.view}, not on the manage code.
     *
     * <p>A MANAGER already sees every item's rate on the Menu Items screen; the catalogue behind
     * those rates is strictly less than what they can already read, and hiding it would leave them
     * looking at a "Standard rate" caption with no way to find out what it means.
     */
    @Override
    public List<TaxClassDto> list() {
        authorization.requireMenuView();
        UUID tenantId = tenantContext.requireTenantId();
        return repository.findAllForTenant(tenantId).stream()
                .map(t -> toDto(tenantId, t))
                .toList();
    }

    @Override
    @Transactional
    public TaxClassDto create(CreateTaxClassRequest request) {
        authorization.requireTaxManage();
        UUID tenantId = tenantContext.requireTenantId();
        String code = request.code().trim();

        // Checked FIRST so the 409 can name the field the user typed into. The unique index is
        // still there and still authoritative under a race — see DuplicateValueException.
        repository.findByTenantAndCode(tenantId, code).ifPresent(existing -> {
            throw new DuplicateValueException("code",
                    "The tax code " + existing.getCode() + " is already used by \"" + existing.getName()
                            + "\" at " + existing.getRatePct().toPlainString()
                            + "%. Edit that rate, or choose a different code.");
        });

        TaxClass entity = new TaxClass();
        entity.setTenantId(tenantId);
        entity.setCode(code);
        entity.setName(request.name().trim());
        entity.setRatePct(request.ratePct());
        entity.setActive(true);
        return toDto(tenantId, repository.save(entity));
    }

    /**
     * <h2>Changing a rate does NOT re-price anything already sold</h2>
     *
     * <p>Nothing here touches an order. Every order line snapshots its rate, code and label at
     * add-item time ({@code OrderItem.taxRatePct}), so a bill printed last month keeps saying what
     * the guest actually paid. The new rate applies from the next line rung.
     *
     * <p>Open checks are the deliberate edge: a line already on an open check keeps the rate it was
     * rung at. That is the same rule the product already applies to price changes, and it is the
     * only rule under which the cart, the charge screen and the paper can agree — a re-price would
     * change a figure the guest has already been shown.
     */
    @Override
    @Transactional
    public TaxClassDto update(UUID id, UpdateTaxClassRequest request) {
        authorization.requireTaxManage();
        UUID tenantId = tenantContext.requireTenantId();
        TaxClass entity = require(tenantId, id);
        String code = request.code().trim();

        repository.findByTenantAndCode(tenantId, code)
                .filter(other -> !other.getId().equals(id))
                .ifPresent(other -> {
                    throw new DuplicateValueException("code",
                            "The tax code " + other.getCode() + " is already used by \""
                                    + other.getName() + "\". Choose a different code.");
                });

        entity.setCode(code);
        entity.setName(request.name().trim());
        entity.setRatePct(request.ratePct());
        entity.setActive(Boolean.TRUE.equals(request.active()));
        return toDto(tenantId, repository.save(entity));
    }

    /**
     * A class in use cannot be deleted, and the refusal counts what is using it.
     *
     * <p>The alternative — {@code ON DELETE SET NULL} — would silently zero-rate every dish in
     * every category that named it, which is precisely the defect this feature exists to close,
     * committed by the product itself instead of by a gap in it. Deactivating is the supported
     * way to stop a rate being chosen again: {@code TaxClassResolver} still honours an inactive
     * class for the items already on it.
     */
    @Override
    @Transactional
    public void delete(UUID id) {
        authorization.requireTaxManage();
        UUID tenantId = tenantContext.requireTenantId();
        TaxClass entity = require(tenantId, id);

        long categories = repository.countCategoriesUsing(tenantId, id);
        long items = repository.countItemsUsing(tenantId, id);
        if (categories > 0 || items > 0) {
            throw new StateInvalidException("TAX_CLASS_IN_USE",
                    "\"" + entity.getName() + "\" is still applied to " + categories
                            + " categor" + (categories == 1 ? "y" : "ies") + " and " + items
                            + " item" + (items == 1 ? "" : "s")
                            + ". Move them to another rate first, or deactivate this one so it "
                            + "stops being offered while the items already on it keep their rate.");
        }
        entity.setDeletedAt(Instant.now());
        entity.setActive(false);
        repository.save(entity);
    }

    private TaxClass require(UUID tenantId, UUID id) {
        return repository.findByIdAndTenantIdAndDeletedAtIsNull(id, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Tax class not found: " + id));
    }

    private TaxClassDto toDto(UUID tenantId, TaxClass t) {
        return new TaxClassDto(
                t.getId(),
                t.getCode(),
                t.getName(),
                t.getRatePct(),
                t.isActive(),
                repository.countCategoriesUsing(tenantId, t.getId()),
                repository.countItemsUsing(tenantId, t.getId()));
    }
}
