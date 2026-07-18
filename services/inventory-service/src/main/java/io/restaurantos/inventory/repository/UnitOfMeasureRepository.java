package io.restaurantos.inventory.repository;

import io.restaurantos.inventory.domain.model.UnitOfMeasure;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface UnitOfMeasureRepository extends JpaRepository<UnitOfMeasure, UUID> {

    /** Relies on the tenantFilter Hibernate filter (+ FORCE RLS) for tenant scoping. */
    Optional<UnitOfMeasure> findByCode(String code);
}
