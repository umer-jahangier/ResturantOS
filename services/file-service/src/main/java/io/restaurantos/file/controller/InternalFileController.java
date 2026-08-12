package io.restaurantos.file.controller;

import io.restaurantos.file.dto.FileDtos.FileMetaResponse;
import io.restaurantos.file.entity.FileMetadataEntity;
import io.restaurantos.file.repository.FileMetadataRepository;
import io.restaurantos.file.service.FileStorageService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
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

    /**
     * Ceiling on a single internal byte read. {@code ImageUploadPolicy.MAX_IMAGE_BYTES} is 2 MiB,
     * so every menu picture is comfortably under this; the margin covers files stored before that
     * policy existed. Its job is to keep the buffered read bounded — the only caller today
     * consumes the whole body over Feign, so streaming would buy nothing and an unbounded read
     * would let one row decide how much heap file-service needs.
     */
    static final long MAX_INTERNAL_CONTENT_BYTES = 8L * 1024 * 1024;

    /** Lets a caller cache by content identity without a second metadata round trip. */
    static final String CONTENT_SHA256_HEADER = "X-Content-Sha256";

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
     * Streams a file's BYTES to a calling service that has already decided the caller may see them.
     *
     * <h2>Why a service may read bytes a user could not read directly</h2>
     *
     * <p>{@code GET /api/v1/files/{id}/download} is gated on {@code file.view}, which is a
     * TENANT-WIDE grant: it reads every file the tenant owns — HR documents, supplier invoice
     * scans, contracts. OWNER, TENANT_ADMIN, MANAGER, ACCOUNTANT and INVENTORY_MANAGER hold it.
     * A cashier does not, and should not.
     *
     * <p>But a cashier must see the photograph on a dish tile, and that photograph is a menu fact.
     * Widening {@code file.view} to make the till render would hand every till in the estate a
     * read of every document in the business — the wrong trade by a very long way. So the
     * authority for a menu picture stays where the menu's authority already is: pos-service gates
     * {@code GET /api/v1/pos/menu/images/{fileId}} on {@code pos.menu.view} and only after
     * confirming that {@code fileId} is the image of one of ITS OWN tenant's menu items. This
     * endpoint is what lets it then fetch the bytes.
     *
     * <p>The blast radius of that arrangement is exactly "the pictures on your own menu". It
     * cannot reach a file that no menu item references, and {@code X-Tenant-Id} plus the
     * tenant-named query below keep it inside one tenant.
     *
     * <p>404 — never 403 — for missing, soft-deleted, wrong-tenant and over-ceiling alike, for
     * the same reason {@link #getMetadata} does: a distinguishable response is a probe.
     */
    @GetMapping("/{id}/content")
    public ResponseEntity<byte[]> getContent(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @PathVariable UUID id) {

        tenantContext.set(tenantId, null, null, null);
        try {
            return fileStorageService.readForTenant(id, tenantId, MAX_INTERNAL_CONTENT_BYTES)
                    .map(content -> ResponseEntity.ok()
                            .header(HttpHeaders.CONTENT_TYPE, content.contentType())
                            .header(CONTENT_SHA256_HEADER, content.sha256() == null ? "" : content.sha256())
                            .body(content.bytes()))
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
