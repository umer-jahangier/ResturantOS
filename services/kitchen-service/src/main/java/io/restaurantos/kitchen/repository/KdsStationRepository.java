package io.restaurantos.kitchen.repository;

import io.restaurantos.kitchen.domain.model.KdsStation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface KdsStationRepository extends JpaRepository<KdsStation, UUID> {

    Optional<KdsStation> findByBranchIdAndCode(UUID branchId, String code);

    List<KdsStation> findByBranchIdAndActiveTrue(UUID branchId);
}
