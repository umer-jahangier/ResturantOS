import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useState } from "react";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { MenuItemImageField } from "@/components/menu/MenuItemImageField";

/**
 * The product's FIRST file input (19b) — there were zero `type="file"` elements anywhere before
 * this, so these assertions set the pattern.
 *
 * <p>The important one is {@link "does not upload a file the server would reject anyway"}:
 * that check is a COURTESY, and the test says so, because the moment someone reads it as the
 * control they will be tempted to move enforcement here. Renaming a file defeats it entirely —
 * file-service reads magic bytes, which is why {@link "surfaces the server's rejection"} exists
 * alongside it.
 */

const FILE_ID = "f1000001-0000-4000-8000-000000000001";

/** jsdom has no object-URL implementation; these tests also assert blobs are revoked. */
const createdUrls: string[] = [];
const revokedUrls: string[] = [];

function pngFile(name = "dish.png", sizeBytes = 1024): File {
  const bytes = new Uint8Array(sizeBytes);
  bytes.set([0x89, 0x50, 0x4e, 0x47]);
  return new File([bytes], name, { type: "image/png" });
}

/** Controlled harness — mirrors how MenuItemFormDialog owns this field's state. */
function Harness({ initialFileId = null }: { initialFileId?: string | null }) {
  const [value, setValue] = useState<string | null>(initialFileId);
  return (
    <MenuItemImageField
      value={value}
      currentImageUrl={null}
      onChange={(fileId) => setValue(fileId)}
    />
  );
}

function renderField(initialFileId: string | null = null) {
  seedSession({ permissions: ["pos.menu.manage", "file.upload", "file.view"] });
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <Harness initialFileId={initialFileId} />
    </Wrapper>,
  );
}

describe("MenuItemImageField", () => {
  // The two object-URL statics are patched INDIVIDUALLY rather than by stubbing the whole `URL`
  // global. Replacing `globalThis.URL` with an object literal breaks `new URL(...)` — which
  // axios and MSW both use on every request — and the resulting failure reads "URL is not a
  // constructor" from somewhere deep in the transport, nowhere near the test that caused it.
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  beforeEach(() => {
    createdUrls.length = 0;
    revokedUrls.length = 0;
    let counter = 0;
    URL.createObjectURL = vi.fn(() => {
      const url = `blob:mock/${counter++}`;
      createdUrls.push(url);
      return url;
    });
    URL.revokeObjectURL = vi.fn((url: string) => {
      revokedUrls.push(url);
    });
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    clearSession();
    vi.clearAllMocks();
  });

  it("shows a placeholder and an upload affordance when there is no picture", () => {
    renderField();
    expect(screen.getByTestId("menu-item-image-empty")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Upload picture/ })).toBeInTheDocument();
    // Nothing to remove yet.
    expect(screen.queryByTestId("menu-item-image-remove")).not.toBeInTheDocument();
  });

  it("puts a valid file on the wire as multipart, with the image purpose", async () => {
    // Asserts the REQUEST, not the resolved upload: MSW cannot deliver a response back to an
    // intercepted multipart XHR under jsdom (the handler runs, the promise never settles), so
    // the successful round trip — preview, Replace/Remove appearing — is proven in a real
    // browser instead. The wire contract is what a unit test can hold onto here, and it is the
    // half that fails silently in production if it regresses (see file-repository-upload.test).
    let requestUrl = "";
    let contentType: string | null = "handler-not-reached";
    const received = new Promise<void>((resolve) => {
      server.use(
        http.post("*/api/v1/files", ({ request }) => {
          requestUrl = request.url;
          contentType = request.headers.get("content-type");
          resolve();
          return HttpResponse.json({ data: null, meta: null, warnings: [] }, { status: 201 });
        }),
      );
    });

    renderField();
    const user = userEvent.setup();
    await user.upload(screen.getByTestId("menu-item-image-input"), pngFile());
    await received;

    expect(requestUrl).toContain("purpose=MENU_ITEM_IMAGE");
    // `application/json` here would mean axios serialised the FormData and the file was dropped.
    expect(contentType).toMatch(/^multipart\/form-data; *boundary=.+/);
    // A local preview appears immediately, before any response — the picker should not feel
    // like it did nothing while the bytes are in flight.
    expect(screen.getByTestId("menu-item-image-preview")).toBeInTheDocument();
  });

  it("does not upload a file the server would reject anyway — a courtesy, not the control", async () => {
    let called = false;
    server.use(
      http.post("*/api/v1/files", () => {
        called = true;
        return HttpResponse.json({ data: null }, { status: 201 });
      }),
    );

    renderField();
    const user = userEvent.setup();
    // 3 MB — over the 2 MiB cap that file-service enforces for real.
    await user.upload(screen.getByTestId("menu-item-image-input"), pngFile("big.png", 3 * 1024 * 1024));

    expect(await screen.findByTestId("menu-item-image-error-message")).toHaveTextContent(
      /maximum is 2 MB/,
    );
    expect(called).toBe(false);
  });

  it("the accept attribute keeps a .pdf out of the picker entirely", async () => {
    renderField();
    const user = userEvent.setup();
    const pdf = new File([new Uint8Array(16)], "menu.pdf", { type: "application/pdf" });
    await user.upload(screen.getByTestId("menu-item-image-input"), pdf);

    // userEvent honours `accept` the way a real OS file dialog does: the file is never selected,
    // so no change event fires and there is nothing to validate or report. This is the outermost
    // and weakest of the three layers — it filters a dialog, it does not enforce anything.
    expect(screen.queryByTestId("menu-item-image-error-message")).not.toBeInTheDocument();
    expect(screen.getByTestId("menu-item-image-empty")).toBeInTheDocument();
  });

  it("rejects a mismatched type that slipped past accept, without a round trip", async () => {
    let called = false;
    server.use(
      http.post("*/api/v1/files", () => {
        called = true;
        return HttpResponse.json({ data: null }, { status: 201 });
      }),
    );

    renderField();
    const user = userEvent.setup();
    // Named .png (so `accept` lets it through) but declared application/pdf — exactly what a
    // renamed file looks like to the browser.
    const disguised = new File([new Uint8Array(16)], "menu.png", { type: "application/pdf" });
    await user.upload(screen.getByTestId("menu-item-image-input"), disguised);

    expect(await screen.findByTestId("menu-item-image-error-message")).toHaveTextContent(
      /JPEG, PNG or WebP/,
    );
    expect(called).toBe(false);
  });

  // NOT TESTED HERE, deliberately: what the field does with file-service's 422 for a file whose
  // BYTES are not an image. No response of any kind — success or failure — comes back through an
  // intercepted multipart XHR under jsdom, so a test for it here would only ever assert the
  // timeout. That path is covered end to end in the browser instead
  // (e2e/menu-item-image.spec.ts uploads a renamed non-image against the real file-service),
  // which is also the only place the magic-byte check itself can be exercised for real.

  it("removing a picture clears the value and restores the placeholder", async () => {
    server.use(
      http.get(`*/api/v1/files/${FILE_ID}/download`, () => HttpResponse.text("bytes")),
    );
    renderField(FILE_ID);
    const user = userEvent.setup();

    expect(screen.getByTestId("menu-item-image-remove")).toBeInTheDocument();
    await user.click(screen.getByTestId("menu-item-image-remove"));

    expect(await screen.findByTestId("menu-item-image-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("menu-item-image-remove")).not.toBeInTheDocument();
  });
});
