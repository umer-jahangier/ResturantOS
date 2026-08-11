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

    /**
     * The tenant predicate IN THE QUERY, not only in the policy.
     *
     * <p>26-CONTEXT is explicit that every new query is tenant-scoped in both places. It is not
     * belt-and-braces here: {@code ReceiptConfigIT} measured {@code findByIdAndDeletedAtIsNull}
     * returning ANOTHER tenant's branch under the integration harness, because Testcontainers runs
     * Postgres as a superuser (so FORCE RLS on {@code branches} is inert) and Hibernate's
     * {@code tenantFilter} is declared on the {@code TenantAuditableEntity} mapped superclass
     * rather than on {@code BranchEntity} itself. Production is protected by the RLS policy; the
     * application layer was not protecting itself at all.
     */
    Optional<BranchEntity> findByIdAndTenantIdAndDeletedAtIsNull(UUID id, UUID tenantId);

    List<BranchEntity> findAllByDeletedAtIsNull();

    List<BranchEntity> findAllByIdInAndDeletedAtIsNull(Collection<UUID> ids);

    boolean existsByName(String name);

    List<BranchEntity> findAllByTenantIdAndDeletedAtIsNull(UUID tenantId);
}
