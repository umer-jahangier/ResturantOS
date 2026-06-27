package io.restaurantos.user.repository;

import io.restaurantos.user.entity.BranchEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface BranchRepository extends JpaRepository<BranchEntity, UUID> {

    Optional<BranchEntity> findByIdAndDeletedAtIsNull(UUID id);

    List<BranchEntity> findAllByDeletedAtIsNull();

    List<BranchEntity> findAllByIdInAndDeletedAtIsNull(Collection<UUID> ids);

    boolean existsByName(String name);

    List<BranchEntity> findAllByTenantIdAndDeletedAtIsNull(UUID tenantId);
}
