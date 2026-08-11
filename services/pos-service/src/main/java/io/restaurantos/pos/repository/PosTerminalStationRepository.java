package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.model.PosTerminalStation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/** The stations a terminal fires to. NO ROWS MEANS EVERY STATION — see {@link PosTerminalStation}. */
@Repository
public interface PosTerminalStationRepository extends JpaRepository<PosTerminalStation, UUID> {

    List<PosTerminalStation> findByTenantIdAndTerminalId(UUID tenantId, UUID terminalId);

    void deleteByTenantIdAndTerminalId(UUID tenantId, UUID terminalId);
}
