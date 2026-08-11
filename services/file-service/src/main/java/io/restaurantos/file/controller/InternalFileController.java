package io.restaurantos.file.controller;

import io.restaurantos.file.dto.FileDtos.FileMetaResponse;
import io.restaurantos.file.entity.FileMetadataEntity;
import io.restaurantos.file.repository.FileMetadataRepository;
import io.restaurantos.file.service.FileStorageService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * Service-to-service file metadata (19b-01). Guarded by {@link
 * io.restaurantos.file.config.FileInternalServiceFilter} (X-Internal-Service secret), NOT by
 * {@code @PreAuthorize} — there is no user principal on {@code /internal/**}.
 *
 * <h2>Why this exists</h2>
 *
 * <p>pos-service stores {@code menu_items.image_file_id}, a plain UUID with no foreign key,
 * because file metadata lives in a different database owned by a different service. Without a
 * way to resolve that id, "attach an image to a menu item" is a write that accepts any UUID a
 * client cares to send — including the id of another tenant's file, or of a PDF. Neither is
 * catastrophic on its own (RLS still refuses the download, so the image simply fails to render)
 * but both persist a reference that is a lie, and the second one is how a "menu image" ends up
 * being an arbitrary stored object that the product will happily emit an {@code <img src>} for.
 *
 * <p>So pos-service resolves the id here before persisting it, and refuses the save if the file
 * does not exist inside the CALLER'S tenant as one of the allowed image types. That is the
 * belt-and-braces posture 17b established: the upload path already enforces this, and this is
 * the second layer that does not assume the first one ran.
 */
@RestController
@RequestMapping("/internal/files")
public class InternalFileController {

    private static final Logger log = LoggerFactory.getLogger(InternalFileController.class);

    private final FileMetadataRepository fileMetadataRepository;
    private final FileStorageService fileStorageService;
    private final TenantContext tenantContext;

    public InternalFileController(FileMetadataRepository fileMetadataRepository,
                                  FileStorageService fileStorageService,
                                  TenantContext tenantContext) {
        this.fileMetadataRepository = fileMetadataRepository;
        this.fileStorageService = fileStorageService;
        this.tenantContext = tenantContext;
    }

    /**
     * Resolves a file inside the given tenant. 404 when the file does not exist, is soft-deleted,
     * or belongs to a different tenant — deliberately the same response for all three, so this
     * endpoint cannot be used to probe whether a given file id exists in some other tenant.
     *
     * <p>The 404 is RETURNED, not thrown. Throwing {@code ResponseStatusException} here produced
     * a 500: shared-lib's {@code GlobalExceptionHandler} has no mapping for it and its catch-all
     * converts anything unrecognised into {@code INTERNAL_ERROR}. Measured — a lookup for an
     * unknown id, and a lookup for a real id from the wrong tenant, both answered
     * {@code 500 "An unexpected error occurred"}. The isolation itself was correct (no metadata
     * ever crossed tenants) but every caller saw a server fault where it should have seen a
     * clean "no such file", which is a meaningfully different thing to report to a user.
     */
    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<FileMetaResponse>> getMetadata(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @PathVariable UUID id) {

        // TenantContext drives the RLS GUC at connection checkout. The query below also names
        // the tenant explicitly (see FileMetadataRepository#findByIdAndTenantId) — under FORCE
        // RLS a missing GUC yields zero rows rather than an error, and "not found" caused by a
        // plumbing gap is indistinguishable from "not found" caused by the tenant check doing
        // its job. Setting both means the answer is right for the right reason.
        tenantContext.set(tenantId, null, null, null);
        try {
            return fileMetadataRepository.findByIdAndTenantId(id, tenantId)
                    .map(meta -> ResponseEntity.ok(ApiResponse.ok(new FileMetaResponse(
                            meta.getId(),
                            meta.getOriginalFilename(),
                            meta.getContentType(),
                            meta.getSizeBytes(),
                            meta.getSha256(),
                            "/api/v1/files/" + meta.getId() + "/download",
                            meta.getCreatedAt()))))
                    .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND).build());
        } finally {
            tenantContext.clear();
        }
    }

    /**
     * Releases a file a calling service has stopped referencing — used when a menu item's image
     * is replaced or removed, so the tenant gets its storage quota back instead of accumulating
     * orphaned objects nobody can see or reach.
     *
     * <p>Soft-delete, exactly like the public {@code DELETE /api/v1/files/{id}}: the MinIO object
     * is retained per file-service's existing compliance contract. Returns 204 for an id that is
     * already gone, because the caller's intent ("this should not be referenced any more") is
     * satisfied either way and a best-effort cleanup must not fail on a retry.
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> release(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @PathVariable UUID id) {

        tenantContext.set(tenantId, null, null, null);
        try {
            if (fileMetadataRepository.findByIdAndTenantId(id, tenantId).isEmpty()) {
                return ResponseEntity.noContent().build();
            }
            fileStorageService.delete(id, tenantId);
            return ResponseEntity.noContent().build();
        } catch (RuntimeException ex) {
            // Never propagate: the caller (pos-service) is releasing a replaced image as a side
            // effect of a menu-item save that has already succeeded. Failing here would either
            // roll back a legitimate save or surface a storage error as a menu error.
            log.warn("Internal release of file {} for tenant {} failed: {}", id, tenantId, ex.getMessage());
            return ResponseEntity.noContent().build();
        } finally {
            tenantContext.clear();
        }
    }
}
