package io.restaurantos.file.service;

import io.minio.*;
import io.minio.errors.MinioException;
import io.restaurantos.file.dto.FileDtos.*;
import io.restaurantos.file.entity.FileMetadataEntity;
import io.restaurantos.file.exception.QuotaExceededException;
import io.restaurantos.file.repository.FileMetadataRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.InputStreamResource;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.UUID;

/**
 * Core file service: upload to MinIO with tenant-scoped object keys, metadata persistence, and download.
 *
 * Object key format: {tenantId}/{fileId}/{sanitizedFilename}
 * This format provides:
 * - Tenant isolation via MinIO key prefix (even without bucket-level policies)
 * - Direct lookup by fileId without a DB round-trip
 * - Human-readable filename for debugging
 */
@Service
public class FileStorageService {

    private static final Logger log = LoggerFactory.getLogger(FileStorageService.class);
    private static final int MAX_FILENAME_LENGTH = 200;

    private final MinioClient minioClient;
    private final QuotaService quotaService;
    private final FileMetadataRepository fileMetadataRepository;
    private final TenantContext tenantContext;
    private final String bucket;

    public FileStorageService(MinioClient minioClient,
                              QuotaService quotaService,
                              FileMetadataRepository fileMetadataRepository,
                              TenantContext tenantContext,
                              @Value("${minio.bucket}") String bucket) {
        this.minioClient = minioClient;
        this.quotaService = quotaService;
        this.fileMetadataRepository = fileMetadataRepository;
        this.tenantContext = tenantContext;
        this.bucket = bucket;
    }

    /**
     * Uploads a file: checks quota BEFORE touching MinIO, then streams to MinIO and persists metadata.
     *
     * @return FileUploadResponse with fileId, objectKey, and download URL
     * @throws QuotaExceededException if the upload would exceed the tenant's storage limit
     */
    @Transactional
    public FileUploadResponse upload(MultipartFile file, UUID tenantId, UUID userId)
            throws IOException, MinioException, NoSuchAlgorithmException {

        long fileSize = file.getSize();
        String sanitizedFilename = sanitizeFilename(file.getOriginalFilename());
        String contentType = file.getContentType() != null ? file.getContentType() : "application/octet-stream";

        quotaService.checkQuota(tenantId, fileSize);

        UUID fileId = UUID.randomUUID();
        String objectKey = tenantId + "/" + fileId + "/" + sanitizedFilename;

        byte[] fileBytes;
        String sha256;
        try {
            fileBytes = file.getBytes();
            sha256 = computeSha256(fileBytes);
        } catch (IOException e) {
            quotaService.releaseQuota(tenantId, fileSize);
            throw e;
        }

        try {
            minioClient.putObject(
                    PutObjectArgs.builder()
                            .bucket(bucket)
                            .object(objectKey)
                            .stream(new java.io.ByteArrayInputStream(fileBytes), fileSize, -1)
                            .contentType(contentType)
                            .build());
        } catch (Exception e) {
            quotaService.releaseQuota(tenantId, fileSize);
            log.error("MinIO upload failed for tenant {} file {}: {}", tenantId, objectKey, e.getMessage());
            throw new RuntimeException("File upload to storage failed: " + e.getMessage(), e);
        }

        FileMetadataEntity entity = new FileMetadataEntity();
        entity.setTenantId(tenantId);
        entity.setUploadedBy(userId);
        entity.setObjectKey(objectKey);
        entity.setOriginalFilename(sanitizedFilename);
        entity.setContentType(contentType);
        entity.setSizeBytes(fileSize);
        entity.setSha256(sha256);

        FileMetadataEntity saved = fileMetadataRepository.save(entity);

        log.info("Uploaded file {} for tenant {} ({} bytes)", objectKey, tenantId, fileSize);

        return new FileUploadResponse(
                saved.getId(),
                objectKey,
                "/api/v1/files/" + saved.getId() + "/download",
                fileSize,
                contentType,
                sha256);
    }

    /**
     * Downloads a file by ID. RLS on the repository ensures cross-tenant access returns 404.
     */
    public ResponseEntity<InputStreamResource> download(UUID fileId) {
        FileMetadataEntity meta = fileMetadataRepository.findByIdAndDeletedAtIsNull(fileId)
                .orElseThrow(() -> new org.springframework.web.server.ResponseStatusException(
                        org.springframework.http.HttpStatus.NOT_FOUND, "File not found"));

        try {
            InputStream stream = minioClient.getObject(
                    GetObjectArgs.builder()
                            .bucket(bucket)
                            .object(meta.getObjectKey())
                            .build());

            return ResponseEntity.ok()
                    .contentType(MediaType.parseMediaType(meta.getContentType()))
                    .contentLength(meta.getSizeBytes())
                    .header(HttpHeaders.CONTENT_DISPOSITION,
                            "attachment; filename=\"" + meta.getOriginalFilename() + "\"")
                    .body(new InputStreamResource(stream));

        } catch (Exception e) {
            log.error("MinIO download failed for file {}: {}", meta.getObjectKey(), e.getMessage());
            throw new RuntimeException("File download from storage failed: " + e.getMessage(), e);
        }
    }

    /**
     * Lists all non-deleted files for the current tenant (RLS-scoped).
     */
    public Page<FileMetadataEntity> listFiles(Pageable pageable) {
        return fileMetadataRepository.findByDeletedAtIsNull(pageable);
    }

    /**
     * Soft-deletes a file by setting deleted_at. MinIO object is retained for compliance.
     */
    @Transactional
    public void delete(UUID fileId, UUID tenantId) {
        FileMetadataEntity meta = fileMetadataRepository.findByIdAndDeletedAtIsNull(fileId)
                .orElseThrow(() -> new org.springframework.web.server.ResponseStatusException(
                        org.springframework.http.HttpStatus.NOT_FOUND, "File not found"));
        meta.setDeletedAt(Instant.now());
        fileMetadataRepository.save(meta);
        quotaService.releaseQuota(tenantId, meta.getSizeBytes());
        log.info("Soft-deleted file {} for tenant {}", meta.getObjectKey(), tenantId);
    }

    /** Removes path separators and enforces maximum filename length. */
    private String sanitizeFilename(String filename) {
        if (filename == null || filename.isBlank()) {
            return "unnamed";
        }
        String sanitized = filename.replaceAll("[/\\\\:*?\"<>|]", "_");
        if (sanitized.length() > MAX_FILENAME_LENGTH) {
            sanitized = sanitized.substring(sanitized.length() - MAX_FILENAME_LENGTH);
        }
        return sanitized;
    }

    private String computeSha256(byte[] data) throws NoSuchAlgorithmException {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest(data);
        return HexFormat.of().formatHex(hash);
    }
}
