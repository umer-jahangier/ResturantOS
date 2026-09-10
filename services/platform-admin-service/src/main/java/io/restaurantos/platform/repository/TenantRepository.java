package io.restaurantos.platform.repository;

import io.restaurantos.platform.entity.TenantEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface TenantRepository extends JpaRepository<TenantEntity, UUID> {
    Optional<TenantEntity> findBySlug(String slug);
    boolean existsBySlug(String slug);

    /**
     * Every tenant, slug-ordered — the fan-out list for a cross-tenant user directory
     * (superadmin plan).
     *
     * <p><b>Slug order, and it is load-bearing rather than cosmetic.</b> There is no cross-tenant
     * user query in this product: {@code auth_db.users} is FORCE row-level security and reachable
     * only one tenant at a time over HTTP, so a fleet-wide user list is the CONCATENATION of N
     * per-tenant lists and its paging is offset arithmetic over that concatenation. That is only
     * coherent if the tenant order is total and stable between requests — an unstable outer order
     * makes page 2 omit and repeat whole tenants, which is the same defect
     * {@code UserRepository.findPageForTenant} fixes one level down by sorting on {@code (email,
     * id)} rather than email alone. {@code slug} is UNIQUE and immutable (login resolves a tenant
     * by it and nothing propagates a rename), so it is a total order that cannot shift under a
     * paging client.
     *
     * <p>Unbounded {@code List} on purpose, unlike {@code ImpersonationLogRepository}'s finders:
     * {@code tenants} is the control plane's own inventory, it is bounded by how many restaurants
     * exist rather than by traffic, and the caller has to know how many there are before it can
     * decide whether the fan-out cap bites. The CALL FAN-OUT is what needs capping, and it is
     * capped in {@code PlatformUserDirectoryService}, not here.
     */
    List<TenantEntity> findAllByOrderBySlugAsc();

    /**
     * Tenants in one lifecycle state, slug-ordered.
     *
     * <p>Exists so a directory scan can be narrowed to, say, ACTIVE tenants and skip the fan-out
     * cost of tenants nobody can log into anyway. Filtering the full list in memory would work and
     * is deliberately not what happens: the count of tenants MATCHED is reported to the caller as
     * scan provenance, and a matched count computed after the fact from a list that was already
     * capped would describe a different set from the one scanned.
     */
    List<TenantEntity> findByStatusOrderBySlugAsc(TenantEntity.TenantStatus status);
}
