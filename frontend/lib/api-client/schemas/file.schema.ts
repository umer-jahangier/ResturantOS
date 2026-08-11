import { z } from "zod";

/**
 * file-service wire contract. Mirrors {@code FileDtos.FileUploadResponse}.
 */
export const apiFileUploadResponseSchema = z.object({
  fileId: z.string().uuid(),
  objectKey: z.string(),
  downloadUrl: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  contentType: z.string(),
  sha256: z.string(),
});

export type UploadedFile = z.infer<typeof apiFileUploadResponseSchema>;

/**
 * Opts an upload into file-service's {@code ImageUploadPolicy}. Must match the constant in
 * {@code ImageUploadPolicy.MENU_ITEM_IMAGE} — send anything else and the upload is stored
 * unchecked, because the policy is opt-in by design (invoice scans are not images).
 */
export const MENU_ITEM_IMAGE_PURPOSE = "MENU_ITEM_IMAGE";

/**
 * Mirrors the SERVER's limits so the form can fail fast with a friendly message instead of
 * making the user wait for a round trip.
 *
 * <p>These are a COURTESY, not a control. The real enforcement is
 * {@code ImageUploadPolicy}, which reads the file's magic bytes — a client-side check reads a
 * name and a browser-supplied MIME type, both of which the user chooses. If these ever drift
 * from the server's values the symptom is a worse error message, never a weaker boundary.
 */
export const MENU_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const MENU_IMAGE_ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
/** For the file input's `accept` attribute — a filter in the OS picker, nothing more. */
export const MENU_IMAGE_ACCEPT_ATTR = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
