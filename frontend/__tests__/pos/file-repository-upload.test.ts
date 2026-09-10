import { describe, it, expect, afterEach, vi } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { FileRepository } from "@/lib/repositories/file.repository";

/**
 * Guards the silent-failure mode in the product's first upload path (19b).
 *
 * <h2>The bug this exists to catch</h2>
 *
 * <p>{@code apiClient} sets a default {@code Content-Type: application/json}. Axios does not
 * override that for a {@code FormData} body — it obeys it, and
 * {@code transformRequest} then does:
 *
 * <pre>if (isFormData) return hasJSONContentType ? JSON.stringify(formDataToJSON(data)) : data;</pre>
 *
 * <p>A {@code File} has no enumerable own properties, so the request that leaves the browser is
 * {@code {"file":{}}} with a JSON content type. The server answers 2xx. The upload contains no
 * file. Nothing anywhere reports a problem — the picture just never appears, days later, on
 * someone else's screen.
 *
 * <p>The repository defends against this with {@code headers: {"Content-Type": undefined}}, and
 * the test below fails the moment that line is removed, because the received content type flips
 * back to {@code application/json}.
 *
 * <h2>Why the request is observed rather than awaited</h2>
 *
 * <p>MSW cannot deliver a response back to an intercepted MULTIPART XHR under jsdom: the handler
 * runs, the response is returned, and the axios promise never settles. That is a limitation of
 * the mock transport, and it is exactly why the assertion here is on the request the handler
 * received rather than on the resolved value. The full round trip is proven against the real
 * gateway in a browser instead.
 */
describe("FileRepository.uploadMenuItemImage — request shape", () => {
  afterEach(() => {
    clearSession();
    vi.clearAllMocks();
  });

  it("sends real multipart with a boundary, and the MENU_ITEM_IMAGE purpose", async () => {
    seedSession({ permissions: ["file.upload"] });

    let contentType: string | null = "handler-not-reached";
    let url = "";
    let authorization: string | null = null;

    const received = new Promise<void>((resolve) => {
      server.use(
        http.post("*/api/v1/files", ({ request }) => {
          contentType = request.headers.get("content-type");
          authorization = request.headers.get("authorization");
          url = request.url;
          resolve();
          // Schema-valid, not `data: null`. uploadMenuItemImage ends in
          // apiFileUploadResponseSchema.parse(response.data.data); null fails it. Under jsdom the
          // multipart XHR never settled so nothing ever parsed, but on CI it does — and because
          // the call below is deliberately not awaited, that ZodError surfaced as an unhandled
          // rejection and failed the whole run, reported against whichever file was running.
          return HttpResponse.json(
            {
              data: {
                fileId: "7c3f1a90-6b2e-4d55-9f18-4a7b0c2d1e33",
                objectKey: "menu/7c3f1a90.png",
                downloadUrl: "/api/v1/files/7c3f1a90-6b2e-4d55-9f18-4a7b0c2d1e33/download",
                sizeBytes: 4,
                contentType: "image/png",
                sha256: "0".repeat(64),
              },
              meta: null,
              warnings: [],
            },
            { status: 201 },
          );
        }),
      );
    });

    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "dish.png", {
      type: "image/png",
    });
    // Deliberately not awaited — see the class note on the jsdom/MSW multipart limitation. The
    // catch is not optional: an unawaited promise that rejects becomes an unhandled rejection,
    // which vitest counts as a run-level error even when every assertion here passes. This test
    // asserts the REQUEST, so however the response turns out is none of its business.
    void FileRepository.uploadMenuItemImage(file).catch(() => {});
    await received;

    // THE assertion. `application/json` here means the file was silently dropped.
    expect(contentType).toMatch(/^multipart\/form-data; *boundary=.+/);
    expect(contentType).not.toContain("application/json");

    // `purpose` is what opts the upload into file-service's ImageUploadPolicy (magic-byte check
    // + 2 MiB cap). Without it the bytes are stored unvalidated — the policy is opt-in so that
    // non-image uploads are not held to image rules.
    expect(url).toContain("purpose=MENU_ITEM_IMAGE");

    // Removing the Content-Type default must not also drop the auth header.
    expect(authorization).toMatch(/^Bearer /);
  });
});
