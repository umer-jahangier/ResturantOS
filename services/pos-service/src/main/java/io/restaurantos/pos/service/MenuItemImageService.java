package io.restaurantos.pos.service;

import feign.FeignException;
import io.restaurantos.pos.feign.FileMetadataClient;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.exception.StateInvalidException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * Owns everything pos-service knows about a menu item's image: validating a proposed
 * {@code imageFileId} before it is persisted, and releasing the previous one afterwards.
 *
 * <p>Kept out of {@link MenuServiceImpl} because it is the only part of the menu write path
 * that talks to another service, and because its two operations have deliberately opposite
 * failure postures which are easier to state — and to not accidentally change — in one place.
 */
@Service
public class MenuItemImageService {

    private static final Logger log = LoggerFactory.getLogger(MenuItemImageService.class);

    /** Must stay in step with file-service's {@code ImageUploadPolicy.ALLOWED_CONTENT_TYPES}. */
    private static final Set<String> ALLOWED_IMAGE_TYPES =
            Set.of("image/jpeg", "image/png", "image/webp");

    private final FileMetadataClient fileMetadataClient;

    public MenuItemImageService(FileMetadataClient fileMetadataClient) {
        this.fileMetadataClient = fileMetadataClient;
    }

    /**
     * Confirms a proposed image reference resolves, inside {@code tenantId}, to a real image.
     *
     * <p>FAIL-CLOSED. file-service already enforced format and size on the way in; this is the
     * second layer, and its job is to refuse to persist a reference nobody has verified on THIS
     * request. A client can send any UUID to {@code POST /menu/items} — the upload endpoint is
     * not the only way an {@code imageFileId} reaches this service, and treating it as if it
     * were is how a menu item ends up pointing at another tenant's invoice scan.
     *
     * <p>An unreachable file-service therefore blocks the save. That is the right trade: the
     * alternative is writing an unverified cross-tenant reference into the catalogue whenever a
     * dependency is having a bad afternoon, and the manager can retry a save.
     *
     * @throws StateInvalidException if the file does not exist in this tenant, is not an image,
     *                               or could not be checked
     */
    public void requireValidImage(UUID tenantId, UUID imageFileId) {
        if (imageFileId == null) {
            return;
        }
        FileMetadataClient.FileMetaDto meta;
        try {
            ApiResponse<FileMetadataClient.FileMetaDto> response =
                    fileMetadataClient.getMetadata(tenantId, imageFileId);
            meta = response != null ? response.data() : null;
        } catch (FeignException.NotFound notFound) {
            // Handled apart from the catch-all below so the two genuinely different situations
            // get two different sentences. "The file is not there" is the user's problem and they
            // can fix it by uploading again; "file-service did not answer" is ours and retrying
            // the same file is the right advice. Collapsing them tells half the users to do
            // something that cannot work.
            //
            // file-service answers 404 identically for "no such file", "soft-deleted" and
            // "belongs to another tenant" — deliberately, so this endpoint cannot be used to
            // probe another tenant's file ids — so this message must not speculate about which.
            throw new StateInvalidException("That image is no longer available. Upload it again.");
        } catch (Exception ex) {
            log.warn("Image reference {} could not be validated for tenant {}: {}",
                    imageFileId, tenantId, ex.getMessage());
            throw new StateInvalidException(
                    "That image could not be verified. Upload it again, or save the item without a picture.");
        }

        if (meta == null) {
            throw new StateInvalidException("That image is no longer available. Upload it again.");
        }

        String contentType = meta.contentType() == null ? "" : meta.contentType().toLowerCase();
        if (!ALLOWED_IMAGE_TYPES.contains(contentType)) {
            throw new StateInvalidException(
                    "That file is not an image (" + meta.contentType() + "). "
                            + "Menu item pictures must be JPEG, PNG or WebP.");
        }
    }

    /**
     * Releases an image that is no longer referenced — the previous file when one is replaced,
     * or the only file when one is removed.
     *
     * <p>FAIL-OPEN, and best effort by design. This runs after a menu-item save that has already
     * committed; throwing here would surface a storage problem as a menu error, or worse, roll
     * back a legitimate edit. The cost of a swallowed failure is one retained object and its
     * quota, which is recoverable; the cost of a propagated one is a manager who cannot change a
     * menu photo.
     *
     * <p>No-op when the id is unchanged or absent, so callers can pass previous/next blindly.
     */
    public void releaseIfReplaced(UUID tenantId, UUID previousFileId, UUID nextFileId) {
        if (previousFileId == null || Objects.equals(previousFileId, nextFileId)) {
            return;
        }
        try {
            fileMetadataClient.release(tenantId, previousFileId);
            log.info("Released replaced menu-item image {} for tenant {}", previousFileId, tenantId);
        } catch (Exception ex) {
            log.warn("Could not release replaced menu-item image {} for tenant {}: {}. "
                            + "The object is retained and still counts against the tenant's quota.",
                    previousFileId, tenantId, ex.getMessage());
        }
    }
}
