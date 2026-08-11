package io.restaurantos.file.controller;

import io.restaurantos.file.dto.FileDtos.*;
import io.restaurantos.file.entity.FileMetadataEntity;
import io.restaurantos.file.exception.InvalidImageException;
import io.restaurantos.file.exception.QuotaExceededException;
import io.restaurantos.file.service.FileStorageService;
import io.restaurantos.file.service.ImageUploadPolicy;
import io.restaurantos.file.service.QuotaService;
import io.restaurantos.shared.api.ApiError;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.core.io.InputStreamResource;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.Map;
import java.util.UUID;

/**
 * REST controller for file operations.
 *
 * Endpoints:
 *   POST   /api/v1/files          — multipart upload; quota checked before MinIO write
 *   GET    /api/v1/files          — paginated list of tenant's files (RLS-scoped)
 *   GET    /api/v1/files/{id}/download — stream file content from MinIO
 *   DELETE /api/v1/files/{id}     — soft-delete
 *   GET    /api/v1/files/quota    — current usage vs limit for the tenant
 *
 * <h2>Authorization</h2>
 *
 * <p>Every endpoint here was gated by {@code .authenticated()} and nothing else until phase 18b:
 * no {@code @PreAuthorize}, no OPA, and no {@code file.*} code in the 65-permission catalogue. The
 * practical consequence was that a KITCHEN_STAFF token — which holds exactly {@code pos.kds.view}
 * and {@code pos.kds.update} — could call {@code DELETE /api/v1/files/&#123;id&#125;} and succeed on
 * any file in the tenant.
 *
 * <p>{@code file.view} covers reading (list, download, quota), {@code file.upload} covers writing,
 * and {@code file.manage} covers deletion. Delete is kept on its own code deliberately: it is the
 * only irreversible operation of the five, and folding it into {@code file.upload} would hand it to
 * every role that attaches an invoice scan. See changeset 082 for the grants and the reasoning.
 *
 * <p>Tenant isolation is separate and unchanged — it comes from RLS plus {@code TenantContext},
 * not from these codes. These answer "may this role touch files at all", which is the question
 * nothing was asking.
 */
@RestController
@RequestMapping("/api/v1/files")
public class FileController {

    private final FileStorageService fileStorageService;
    private final QuotaService quotaService;
    private final TenantContext tenantContext;
    private final ImageUploadPolicy imageUploadPolicy;

    public FileController(FileStorageService fileStorageService,
                          QuotaService quotaService,
                          TenantContext tenantContext,
                          ImageUploadPolicy imageUploadPolicy) {
        this.fileStorageService = fileStorageService;
        this.quotaService = quotaService;
        this.tenantContext = tenantContext;
        this.imageUploadPolicy = imageUploadPolicy;
    }

    /**
     * Multipart file upload with pre-upload quota enforcement.
     *
     * @param purpose optional, opt-in. {@code MENU_ITEM_IMAGE} subjects the upload to
     *                {@link ImageUploadPolicy} — magic-byte format check and a 2 MiB cap, both
     *                enforced HERE rather than in the browser, because the gateway will accept a
     *                direct POST from anything holding a token and a client-side limit is only a
     *                suggestion. Absent (every pre-19b caller), behaviour is exactly as before.
     */
    @PostMapping(consumes = "multipart/form-data")
    @PreAuthorize("hasAuthority('file.upload')")
    public ResponseEntity<ApiResponse<FileUploadResponse>> upload(
            @RequestPart("file") MultipartFile file,
            @RequestParam(value = "purpose", required = false) String purpose) throws Exception {

        UUID tenantId = tenantContext.requireTenantId();
        UUID userId = tenantContext.getUserId().orElse(null);

        // Returns the SNIFFED content type (or null when this is not an image upload). Storing
        // that rather than the client's declared header is the point: download() sets its
        // response Content-Type from the stored value, so a forged "image/png" on a non-image
        // must never survive into the record.
        String enforcedContentType = imageUploadPolicy.enforce(file, purpose);

        FileUploadResponse response =
                fileStorageService.upload(file, tenantId, userId, enforcedContentType);
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(response));
    }

    /** Paginated list of non-deleted files for the current tenant. */
    @GetMapping
    @PreAuthorize("hasAuthority('file.view')")
    public ResponseEntity<ApiResponse<java.util.List<FileMetaResponse>>> list(
            @PageableDefault(size = 20) Pageable pageable) {

        Page<FileMetadataEntity> page = fileStorageService.listFiles(pageable);
        var items = page.getContent().stream().map(this::toMeta).toList();
        return ResponseEntity.ok(ApiResponse.paginated(items,
                new io.restaurantos.shared.api.PageMeta(
                        new io.restaurantos.shared.api.PageMeta.Page(
                                String.valueOf(page.getNumber()),
                                page.hasNext() ? String.valueOf(page.getNumber() + 1) : null,
                                page.getSize()),
                        page.getTotalElements())));
    }

    /** Stream file content from MinIO with correct Content-Type and Content-Disposition. */
    @GetMapping("/{id}/download")
    @PreAuthorize("hasAuthority('file.view')")
    public ResponseEntity<InputStreamResource> download(@PathVariable UUID id) {
        return fileStorageService.download(id);
    }

    /** Soft-delete a file (retains MinIO object for compliance). */
    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('file.manage')")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable UUID id) {
        UUID tenantId = tenantContext.requireTenantId();
        fileStorageService.delete(id, tenantId);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    /** Returns current storage usage and limit for the current tenant. */
    @GetMapping("/quota")
    @PreAuthorize("hasAuthority('file.view')")
    public ResponseEntity<ApiResponse<QuotaStatusResponse>> quota() {
        UUID tenantId = tenantContext.requireTenantId();
        long limitBytes = quotaService.getStorageLimitBytes(tenantId);
        long usedBytes = fileStorageService.listFiles(Pageable.unpaged()).stream()
                .mapToLong(FileMetadataEntity::getSizeBytes)
                .sum();
        double pct = (limitBytes > 0) ? (usedBytes * 100.0 / limitBytes) : 0.0;
        return ResponseEntity.ok(ApiResponse.ok(new QuotaStatusResponse(usedBytes, limitBytes, pct)));
    }

    @ExceptionHandler(QuotaExceededException.class)
    public ResponseEntity<ApiResponse<Void>> handleQuotaExceeded(QuotaExceededException ex) {
        var warning = new ApiResponse.ApiWarning("QUOTA_EXCEEDED", ex.getMessage());
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(new ApiResponse<>(null, null, java.util.List.of(warning)));
    }

    /**
     * 422 with the policy's own sentence, in the standard {@link ApiError} envelope.
     *
     * <p>Handled HERE rather than left to shared-lib's {@code GlobalExceptionHandler}, because
     * that handler has no mapping for this and its catch-all turns anything unrecognised into
     * {@code 500 INTERNAL_ERROR / "An unexpected error occurred"}. Measured before this handler
     * existed: uploading a renamed executable was correctly REFUSED (nothing was stored) but the
     * caller was told the server had crashed, so a user with a fixable problem — wrong file —
     * had no way to know that. A controller-local {@code @ExceptionHandler} takes precedence
     * over the {@code @ControllerAdvice}, which is the same mechanism the quota handler above
     * already relies on.
     */
    @ExceptionHandler(InvalidImageException.class)
    public ResponseEntity<ApiError> handleInvalidImage(InvalidImageException ex) {
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                .body(ApiError.of("INVALID_IMAGE", ex.getMessage(), null));
    }

    private FileMetaResponse toMeta(FileMetadataEntity e) {
        return new FileMetaResponse(
                e.getId(),
                e.getOriginalFilename(),
                e.getContentType(),
                e.getSizeBytes(),
                e.getSha256(),
                "/api/v1/files/" + e.getId() + "/download",
                e.getCreatedAt());
    }
}
