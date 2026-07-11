package io.restaurantos.purchasing.repository;

import io.restaurantos.purchasing.domain.model.TenantMatchTolerance;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface TenantMatchToleranceRepository extends JpaRepository<TenantMatchTolerance, UUID> {}
