import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./mocks/server";

// jsdom implements neither ResizeObserver nor Element.scrollIntoView, both of which cmdk's
// Command.List uses to track and scroll the highlighted option. Any test that OPENS a
// CatalogItemCombobox popover needs them (a test that only asserts the disabled trigger does not).
//
// Lives here rather than per-file: po-line-catalog-picker.test.tsx originally stubbed these
// locally while it was the only such test, and the GL account picker made it the second — at which
// point copying the stub a third time is worse than owning it once in the shared setup.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}

// MSW's XMLHttpRequest interceptor builds a ProgressEvent when it responds to an intercepted
// XHR. jsdom implements ProgressEvent on its window, but Node has no global of that name and
// vitest's jsdom environment does not surface this one on globalThis — so the interceptor throws
// "ReferenceError: ProgressEvent is not defined" from inside its own respondWith.
//
// It surfaces as an UNHANDLED error rather than a test failure, because the XHR that triggers it
// is one nobody is awaiting: the whole suite passed (209 files, 2661 tests) and the run still
// exited 1 on a single error, attributed to whichever file happened to be running at the time.
// That is the same late-landing-request family as the upload leak in file-repository-upload.
//
// Bridged from jsdom's real implementation rather than hand-rolled, so anything asserting on the
// event's shape gets the genuine article.
if (typeof globalThis.ProgressEvent === "undefined") {
  // Prefer jsdom's real class when a window is still standing. The fallback matters for the case
  // this actually guards: the interceptor can respond AFTER the originating file's environment has
  // been torn down, when there is no window left to borrow from.
  const fromWindow =
    typeof window !== "undefined"
      ? (window as unknown as { ProgressEvent?: unknown }).ProgressEvent
      : undefined;
  globalThis.ProgressEvent = (fromWindow ??
    class ProgressEventPolyfill extends Event {
      readonly lengthComputable: boolean;
      readonly loaded: number;
      readonly total: number;
      constructor(type: string, init: ProgressEventInit = {}) {
        super(type, init);
        this.lengthComputable = init.lengthComputable ?? false;
        this.loaded = init.loaded ?? 0;
        this.total = init.total ?? 0;
      }
    }) as typeof ProgressEvent;
}

// MSW Node server lifecycle. `onUnhandledRequest: "error"` fails fast on any
// request that no handler covers, keeping the contract tests honest.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
