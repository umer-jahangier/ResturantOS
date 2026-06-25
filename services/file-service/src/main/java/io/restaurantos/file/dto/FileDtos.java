package io.restaurantos.file.dto;

import java.util.UUID;

/**
 * DTOs for file-service REST API. Wire format is camelCase [04-01-C].
 */
public final class FileDtos {

    private FileDtos() {}

    public record FileUploadResponse(
        UUID fileId,
        String objectKey,
        String downloadUrl,
        long sizeBytes,
        String contentType,
        String sha256
    ) {}

    public record FileMetaResponse(
        UUID fileId,
        String originalFilename,
        String contentType,
        long sizeBytes,
        String sha256,
        String downloadUrl,
        java.time.Instant createdAt
    ) {}

    public record QuotaStatusResponse(
        long usedBytes,
        long limitBytes,
        double usedPercent
    ) {}
}
