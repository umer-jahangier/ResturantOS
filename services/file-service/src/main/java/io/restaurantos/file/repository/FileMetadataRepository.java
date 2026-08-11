package io.restaurantos.file.repository;

import io.restaurantos.file.entity.FileMetadataEntity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface FileMetadataRepository extends JpaRepository<FileMetadataEntity, UUID> {

    /**
     * Sums the size_bytes of all non-deleted files for the current tenant.
     * RLS automatically scopes this query to the current tenant via the tenantFilter.
     * Returns 0 when no files exist (COALESCE).
     */
    @Query("SELECT COALESCE(SUM(f.sizeBytes), 0) FROM FileMetadataEntity f WHERE f.deletedAt IS NULL")
    long sumSizeBytesByTenantId();

    /** Returns all non-deleted files for the current tenant, scoped by RLS. */
    Page<FileMetadataEntity> findByDeletedAtIsNull(Pageable pageable);

    /** Finds a non-deleted file by ID; RLS ensures cross-tenant lookups return empty. */
    Optional<FileMetadataEntity> findByIdAndDeletedAtIsNull(UUID id);

    /**
     * Explicit-tenant lookup for the {@code /internal/**} seam (19b-01).
     *
     * <p>{@code file_metadata} runs {@code FORCE ROW LEVEL SECURITY}, and under FORCE an
     * unscoped query returns <em>zero rows rather than an error</em>. Internal calls carry no
     * JWT, so the tenant reaches this service as a header that a caller controls, and the whole
     * point of the endpoint is to answer "does this file belong to the tenant asking". Naming
     * the tenant in the query means that answer does not depend on the GUC having been set by a
     * filter that never ran on this path — and it means a missing GUC produces "not found",
     * which is the same answer as "wrong tenant", rather than an empty result that some future
     * caller reads as "no constraint applied".
     */
    @Query("""
            SELECT f FROM FileMetadataEntity f
             WHERE f.id = :id
               AND f.tenantId = :tenantId
               AND f.deletedAt IS NULL
            """)
    Optional<FileMetadataEntity> findByIdAndTenantId(@Param("id") UUID id,
                                                     @Param("tenantId") UUID tenantId);
}
