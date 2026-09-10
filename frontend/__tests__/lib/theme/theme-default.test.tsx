import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

/**
 * The product opens DARK, and light mode survives it.
 *
 * <h3>The defect this pins</h3>
 *
 * The provider was `defaultTheme="system"`, so the product opened in whatever the machine
 * happened to prefer. The reference it is judged against — `Docs/NEXUS_ERP_Demo.html` — is
 * dark-only: `grep -c 'prefers-color-scheme|data-theme'` over it returns **0**, it has no light
 * path at all. So on a light-mode laptop the first screen of the product was a white office app
 * being compared to a dark one, and *"the app does not match the UI style I gave you as demo"*
 * was, in part, exactly that — the flagship look was reachable only by someone who had already
 * changed a setting.
 *
 * <h3>Why BOTH props are asserted, together</h3>
 *
 * `defaultTheme="dark"` alone is the intended change. `defaultTheme="dark"` *without*
 * `enableSystem` is a different and worse one: it removes "System" from `ThemeToggle`'s
 * light → dark → system cycle, turning the third icon into a button that does nothing, and it
 * strands every user who wants the OS to drive the choice. The two props are ONE decision — dark
 * is the default, not the only option — so dropping either half should fail here rather than pass
 * as a tidy-up.
 *
 * <h3>What this measures, and what it deliberately does not</h3>
 *
 * It measures the configuration THIS repo owns: the props our provider hands the library. It does
 * not re-test `@teispace/next-themes`' own resolution logic — that is the library's, and mounting
 * it here is not possible anyway (its ESM build does
 * `import { useServerInsertedHTML } from 'next/navigation'` without the extension Node's resolver
 * requires, which is why `state-character.test.tsx` mocks it too).
 *
 * <p>The resolution behaviour was instead verified in a real browser against the dev server, and
 * the four results are recorded here so a later reader does not have to take the change on trust:
 *
 * <pre>
 *   localStorage        OS preference   →  html class   --background
 *   (nothing stored)    light           →  dark         oklch(.132 .014 260)   ← the fix
 *   "light"             dark            →  light        oklch(1 0 260)         ← user outranks all
 *   "system"            light           →  light        oklch(1 0 260)         ← enableSystem live
 * </pre>
 *
 * The third row is the one that proves `enableSystem` still works: with system selected and the
 * OS on light it resolved LIGHT, not the dark default — so the media query is genuinely consulted
 * rather than falling through to `defaultTheme`.
 */

const captured: { props?: Record<string, unknown> } = {};

vi.mock("@teispace/next-themes", () => ({
  ThemeProvider: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => {
    captured.props = props;
    return <div data-testid="themed">{children}</div>;
  },
}));

async function renderProvider() {
  const { ThemeProvider } = await import("@/components/providers/theme-provider");
  render(
    <ThemeProvider>
      <span>app</span>
    </ThemeProvider>,
  );
  expect(screen.getByTestId("themed")).toBeTruthy();
  return captured.props ?? {};
}

describe("the product's default theme is dark, and light is still fully reachable", () => {
  it("hands the library defaultTheme=dark — a first-time visitor gets the flagship look", async () => {
    const props = await renderProvider();
    expect(props.defaultTheme).toBe("dark");
    // Not "system", which is what shipped and what the review was reacting to.
    expect(props.defaultTheme).not.toBe("system");
  });

  it("keeps enableSystem, so `system` stays a real choice and light stays supported", async () => {
    const props = await renderProvider();
    expect(
      props.enableSystem,
      "dropping enableSystem deletes the System option from the theme cycle",
    ).toBe(true);
  });

  it("still drives the class attribute, which is what every dark: variant keys off", async () => {
    /*
     * `attribute="class"` is load-bearing and easy to lose in a props edit: the whole stylesheet
     * is written against `.dark` (`@custom-variant dark (&:is(.dark *))` in globals.css). Switch
     * this to `data-theme` and the default would still be "dark" while nothing on screen changed.
     */
    const props = await renderProvider();
    expect(props.attribute).toBe("class");
  });

  it("leaves the View-Transition reveal configured exactly as D-38-14 set it", async () => {
    /*
     * The reveal is independent of which theme is DEFAULT — it fires on `setTheme`, whatever the
     * starting point — but this file is where a props edit would land, so the four values that
     * make it a deliberate animation rather than the fork's default are pinned alongside.
     *
     * `origin: "center"` in particular is NOT the library default (`"cursor"`): with "cursor" a
     * theme toggled from the command palette blooms from wherever the user last clicked, which
     * reads as a rendering glitch. Duration and easing restate --motion-entrance /
     * --motion-entrance-ease, and `bundle-budget.test.ts` is what keeps them tied to the tokens.
     */
    const props = await renderProvider();
    expect(props.transition).toEqual({
      type: "circular",
      origin: "center",
      duration: 420,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
    });
  });
});
