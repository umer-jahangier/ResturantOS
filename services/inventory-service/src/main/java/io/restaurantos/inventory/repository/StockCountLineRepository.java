package io.restaurantos.inventory.repository;

import io.restaurantos.inventory.domain.model.StockCountLine;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * NOT in 08-08-PLAN.md's {@code files_modified} list — a Rule 2 (missing critical functionality)
 * addition. {@link io.restaurantos.inventory.domain.model.StockCountLine} needs a repository to
 * persist its rows, mirroring every other line-entity in this phase ({@code StockTransferLine} /
 * {@code StockTransferLineRepository}); a plain flat FK column (not a JPA {@code @OneToMany}
 * collection) is this codebase's established convention for count/transfer lines.
 */
@Repository
public interface StockCountLineRepository extends JpaRepository<StockCountLine, UUID> {

    List<StockCountLine> findByCountId(UUID countId);
}
