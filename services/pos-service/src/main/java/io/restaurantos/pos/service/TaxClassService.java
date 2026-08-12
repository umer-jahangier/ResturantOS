package io.restaurantos.pos.service;

import io.restaurantos.pos.dto.TaxClassDtos.CreateTaxClassRequest;
import io.restaurantos.pos.dto.TaxClassDtos.TaxClassDto;
import io.restaurantos.pos.dto.TaxClassDtos.UpdateTaxClassRequest;

import java.util.List;
import java.util.UUID;

/** The tenant's sales-tax catalogue (F16). */
public interface TaxClassService {

    List<TaxClassDto> list();

    TaxClassDto create(CreateTaxClassRequest request);

    TaxClassDto update(UUID id, UpdateTaxClassRequest request);

    /**
     * Retire a class. Refuses while any category or item still points at it, naming how many —
     * removing a rate out from under a live menu is the failure this whole feature closes.
     */
    void delete(UUID id);
}
