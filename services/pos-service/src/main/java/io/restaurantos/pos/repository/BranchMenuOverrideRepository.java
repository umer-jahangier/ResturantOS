package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.model.BranchMenuOverride;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface BranchMenuOverrideRepository extends JpaRepository<BranchMenuOverride, UUID> {

    @Query("SELECT o FROM BranchMenuOverride o WHERE o.branchId = :branchId AND o.menuItem.id = :menuItemId")
    Optional<BranchMenuOverride> findByBranchIdAndMenuItemId(
            @Param("branchId") UUID branchId,
            @Param("menuItemId") UUID menuItemId);
}
