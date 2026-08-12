import { apiClient } from "@/lib/api-client/client";
import {
  apiFileUploadResponseSchema,
  MENU_ITEM_IMAGE_PURPOSE,
  type UploadedFile,
} from "@/lib/api-client/schemas/file.schema";

/**
 * Layer-2 file repository — the product's FIRST upload path, so it sets the pattern.
 *
 * <h2>Two things here are not like the other repositories</h2>
 *
 * <p><strong>1. {@code Content-Type: undefined} is load-bearing, and its absence fails
 * SILENTLY.</strong> {@code apiClient} declares a default of {@code application/json}. Axios does
 * NOT strip that for a {@code FormData} body — it obeys it. From
 * {@code axios/lib/defaults/index.js}:
 *
 * <pre>
 *   if (isFormData) {
 *     return hasJSONContentType ? JSON.stringify(formDataToJSON(data)) : data;
 *   }
 * </pre>
 *
 * <p>So with the default left in place, axios serialises the FormData to JSON and posts
 * {@code {"file":{}}} — a `File` has no enumerable own properties, so the picture is discarded
 * on the way out and the request succeeds with a 2xx. Measured, not theorised: the server
 * received exactly that body and {@code Content-Type: application/json}. Nothing errors; the
 * upload simply contains no file. Passing {@code undefined} removes the header so the browser
 * sets {@code multipart/form-data} with its generated boundary — verified as
 * {@code multipart/form-data; boundary=----formdata-undici-…} on the received request.
 *
 * <p>Writing {@code "multipart/form-data"} by hand is not a substitute: it produces the same
 * header MINUS the boundary, which no server can parse.
 *
 * <p><em>Harness note:</em> MSW cannot return a response for an intercepted multipart XHR under
 * jsdom — the handler runs and the promise never settles — so the happy path of this method is
 * proven in a real browser (Playwright), not in a unit test. That is a limitation of the mock
 * transport, not of this code; the unit tests assert the request SHAPE reaching the handler.
 *
 * <p><strong>2. Downloads come back as blobs, not URLs.</strong> {@code GET /api/v1/files/{id}
 * /download} is gated on {@code file.view}, so it needs an {@code Authorization} header — and an
 * {@code <img src>} cannot send one. Pointing an image tag at that path yields a 401 and a
 * broken-image icon. So the bytes are fetched through the same authenticated client as
 * everything else and handed to the DOM as an object URL.
 */
export const FileRepository = {
  /**
   * Uploads a menu-item picture.
   *
   * <p>{@code purpose} is what opts this request into file-service's {@code ImageUploadPolicy}
   * — magic-byte format check and a 2 MiB cap. Both are enforced on the SERVER. The form also
   * checks size and type before calling this, and that check is a courtesy that produces a fast,
   * friendly message; it is not a control. Anyone can POST to the gateway directly.
   */
  async uploadMenuItemImage(file: File): Promise<UploadedFile> {
    const body = new FormData();
    body.append("file", file);

    const response = await apiClient.post<{ data: unknown }>("/api/v1/files", body, {
      params: { purpose: MENU_ITEM_IMAGE_PURPOSE },
      // DO NOT REMOVE. Without this, axios honours the instance's application/json default and
      // JSON-stringifies the FormData to {"file":{}} — a 2xx upload containing no file at all.
      // See the class note for the axios source that does it.
      headers: { "Content-Type": undefined },
    });

    return apiFileUploadResponseSchema.parse(response.data.data);
  },

  /**
   * Fetches image bytes through the authenticated client.
   *
   * <p>Returns the {@code Blob} rather than an object URL, deliberately. An object URL is a
   * document-lifetime resource that must be revoked exactly once by whoever owns its lifetime,
   * and a repository — a stateless translation layer — is the wrong place to mint one: it would
   * hand out a resource it cannot account for. {@code useAuthenticatedImage} creates and revokes
   * the URL, and the blob's {@code size} is what lets its cache stay inside a memory budget
   * instead of pinning every picture a till has ever scrolled past.
   */
  async fetchBlob(downloadPath: string): Promise<Blob> {
    const response = await apiClient.get<Blob>(downloadPath, { responseType: "blob" });
    return response.data;
  },
};
