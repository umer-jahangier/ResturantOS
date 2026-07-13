package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.model.Station;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface StationRepository extends JpaRepository<Station, UUID> {

    List<Station> findByBranchId(UUID branchId);

    List<Station> findByBranchIdAndActiveTrue(UUID branchId);

    Optional<Station> findByBranchIdAndCode(UUID branchId, String code);

    Optional<Station> findByIdAndBranchId(UUID id, UUID branchId);
}
