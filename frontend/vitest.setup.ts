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

// MSW Node server lifecycle. `onUnhandledRequest: "error"` fails fast on any
// request that no handler covers, keeping the contract tests honest.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
