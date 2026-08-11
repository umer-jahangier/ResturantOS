package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.model.PosTerminalCategory;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/** The categories a terminal offers. NO ROWS MEANS EVERY CATEGORY — see {@link PosTerminalCategory}. */
@Repository
public interface PosTerminalCategoryRepository extends JpaRepository<PosTerminalCategory, UUID> {

    List<PosTerminalCategory> findByTenantIdAndTerminalId(UUID tenantId, UUID terminalId);

    void deleteByTenantIdAndTerminalId(UUID tenantId, UUID terminalId);
}
