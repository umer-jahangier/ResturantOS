package io.restaurantos.file.repository;

import io.restaurantos.file.entity.FileMetadataEntity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
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
}
