import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node, not jsdom: this package emits bytes for a socket and must never depend on a DOM.
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
