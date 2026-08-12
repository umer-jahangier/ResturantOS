package io.restaurantos.pos.service;

import feign.FeignException;
import io.restaurantos.pos.feign.FileMetadataClient;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.exception.StateInvalidException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;

import java.util.Objects;
import java.util.Optional;
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
    private final MenuItemRepository menuItemRepository;

    public MenuItemImageService(FileMetadataClient fileMetadataClient,
                                MenuItemRepository menuItemRepository) {
        this.fileMetadataClient = fileMetadataClient;
        this.menuItemRepository = menuItemRepository;
    }

    /** A menu picture's bytes and the content type file-service sniffed from them. */
    public record MenuImage(byte[] bytes, String contentType) {}

    /**
     * Reads a menu picture for a caller who holds {@code pos.menu.view}.
     *
     * <h2>Why the till does not fetch the file directly</h2>
     *
     * <p>The photograph lives in file-service, whose download route is gated on
     * {@code file.view} — a TENANT-WIDE read of every stored document: HR files, invoice scans,
     * contracts. A cashier holds {@code pos.menu.view} and does not hold {@code file.view}, which
     * is correct and must stay that way. Measured on 2026-08-12 before this method existed: the
     * cashier's own bearer against {@code /api/v1/files/{id}/download} answered
     * {@code 403 PERMISSION_DENIED}, so a till grid that rendered {@code <img src={imageUrl}>}
     * would have painted a failed picture on every photographed dish.
     *
     * <p>Granting {@code file.view} to CASHIER would have made the grid render. It would also
     * have handed every till in the estate a read of every document the business stores, to show
     * a photograph of a curry. So the authority stays where the menu's authority already is: this
     * method answers only for a file id that is the image of a menu item IN THE CALLER'S TENANT,
     * and refuses everything else with the same "not found" it gives a nonexistent id.
     *
     * <p>Note the ordering — ownership is established against pos-service's OWN rows BEFORE the
     * internal seam is dialled. The seam carries no user identity, so it cannot make this
     * decision; if the check moved after the fetch, the endpoint would become an oracle for
     * whether an arbitrary file id exists in the tenant.
     *
     * @return empty when no menu item in {@code tenantId} carries this picture, when file-service
     *         no longer has it, or when file-service could not be reached — the caller renders
     *         all three as "no picture", which is the only honest thing a till can do with them
     */
    public Optional<MenuImage> readMenuImage(UUID tenantId, UUID imageFileId) {
        if (imageFileId == null) {
            return Optional.empty();
        }
        if (!menuItemRepository.existsByTenantIdAndImageFileId(tenantId, imageFileId)) {
            // Not "forbidden": a file id that is not on this tenant's menu is, as far as the menu
            // is concerned, not a thing that exists. Answering 403 here would confirm the id is
            // real somewhere, which is exactly the probe InternalFileController refuses to be.
            return Optional.empty();
        }
        try {
            ResponseEntity<byte[]> response = fileMetadataClient.getContent(tenantId, imageFileId);
            byte[] body = response == null ? null : response.getBody();
            if (body == null || body.length == 0) {
                return Optional.empty();
            }
            MediaType type = response.getHeaders().getContentType();
            String contentType = type == null ? "application/octet-stream" : type.toString();
            if (!ALLOWED_IMAGE_TYPES.contains(contentType.toLowerCase())) {
                // The upload path sniffs and stores the real type, and requireValidImage refuses
                // to persist a reference to anything else — so reaching here means a row predates
                // one of those controls. Serving it anyway would let a stored non-image be emitted
                // to a browser under an <img> tag, which is the one outcome 19b set out to stop.
                log.warn("Menu image {} for tenant {} is stored as {} — refusing to serve it as an image",
                        imageFileId, tenantId, contentType);
                return Optional.empty();
            }
            return Optional.of(new MenuImage(body, contentType));
        } catch (FeignException.NotFound notFound) {
            return Optional.empty();
        } catch (Exception ex) {
            // FAIL-SOFT, unlike requireValidImage above. Nothing is being persisted here and the
            // cashier is mid-service: a till that refuses to draw a tile because a storage
            // service is slow is worse than a till that draws the tile without its photograph.
            log.warn("Menu image {} could not be read for tenant {}: {}",
                    imageFileId, tenantId, ex.getMessage());
            return Optional.empty();
        }
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
