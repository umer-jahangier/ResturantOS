package io.restaurantos.file.entity;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

/**
 * Represents a file uploaded by a tenant user, stored in MinIO.
 * The objectKey follows the pattern: {tenantId}/{fileId}/{filename}.
 * Inherits tenantId, createdAt, updatedAt, createdBy, updatedBy, deletedAt from TenantAuditableEntity.
 */
@Getter
@Setter
@Entity
@Table(name = "file_metadata")
public class FileMetadataEntity extends TenantAuditableEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    /** User who uploaded the file (JWT sub claim). */
    @Column(name = "uploaded_by", nullable = false)
    private UUID uploadedBy;

    /** MinIO object key: {tenantId}/{fileId}/{filename}. Globally unique within the bucket. */
    @Column(name = "object_key", nullable = false, length = 1024)
    private String objectKey;

    /** Original filename as provided by the client. */
    @Column(name = "original_filename", nullable = false, length = 512)
    private String originalFilename;

    /** MIME type of the uploaded file. */
    @Column(name = "content_type", nullable = false, length = 255)
    private String contentType;

    /** Size of the uploaded file in bytes. */
    @Column(name = "size_bytes", nullable = false)
    private long sizeBytes;

    /** SHA-256 digest of the file content for integrity verification. */
    @Column(name = "sha256", length = 64)
    private String sha256;
}
