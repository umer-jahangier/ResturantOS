package io.restaurantos.inventory.repository;

import io.restaurantos.inventory.domain.model.UnitOfMeasure;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface UnitOfMeasureRepository extends JpaRepository<UnitOfMeasure, UUID> {

    /** Relies on the tenantFilter Hibernate filter (+ FORCE RLS) for tenant scoping. */
    Optional<UnitOfMeasure> findByCode(String code);

    /**
     * Batch variant of {@link #findByCode(String)} — {@code RecipeCostPreviewService} resolves
     * every distinct UOM code referenced by a draft line array in ONE query rather than one
     * lookup per line (T-08.2-074). Relies on the same tenantFilter Hibernate filter (+ FORCE RLS)
     * for tenant scoping.
     */
    List<UnitOfMeasure> findByCodeIn(Collection<String> codes);
}
