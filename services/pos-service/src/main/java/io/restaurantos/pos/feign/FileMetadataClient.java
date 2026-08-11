package io.restaurantos.pos.feign;

import io.restaurantos.pos.config.FeignClientConfig;
import io.restaurantos.shared.api.ApiResponse;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;

import java.time.Instant;
import java.util.UUID;

/**
 * file-service metadata seam (19b-01) — used to validate {@code menu_items.image_file_id}
 * before it is persisted, and to release the previous image when one is replaced or removed.
 *
 * <p>There is no foreign key behind {@code image_file_id}: file metadata lives in
 * {@code file_db}, owned by a different service. Application-level resolution is therefore the
 * only referential integrity available, and skipping it would mean the menu-item write accepts
 * any UUID a client sends — another tenant's file id, or a PDF's.
 *
 * <p><strong>Fail-closed on validation, fail-open on cleanup.</strong> The two calls have
 * opposite failure postures on purpose, and the reason is what each one protects:
 * {@link #getMetadata} decides whether to persist a reference, so an unreachable file-service
 * must reject the save rather than write an unverified id. {@link #release} is housekeeping
 * after a save that has already succeeded, so an unreachable file-service must not fail — the
 * worst case is a retained object and some unrecovered quota, and the alternative is refusing a
 * legitimate menu edit because a storage service is down.
 */
@FeignClient(name = "file-service", contextId = "fileMetadataClient", configuration = FeignClientConfig.class)
public interface FileMetadataClient {

    @GetMapping("/internal/files/{id}")
    ApiResponse<FileMetaDto> getMetadata(@RequestHeader("X-Tenant-Id") UUID tenantId,
                                         @PathVariable("id") UUID id);

    @DeleteMapping("/internal/files/{id}")
    void release(@RequestHeader("X-Tenant-Id") UUID tenantId, @PathVariable("id") UUID id);

    /** Mirrors file-service's {@code FileDtos.FileMetaResponse}. */
    record FileMetaDto(
            UUID fileId,
            String originalFilename,
            String contentType,
            long sizeBytes,
            String sha256,
            String downloadUrl,
            Instant createdAt
    ) {}
}
