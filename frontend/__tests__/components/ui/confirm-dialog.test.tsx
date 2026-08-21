import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ConfirmDialog, NON_ANSWER_LABELS } from "@/components/ui/confirm-dialog";
import { frontendRoot } from "@/__tests__/lib/theme/conformance-scan";

/**
 * `ConfirmDialog` — one primitive replacing six (UI-SPEC §8.2, §8.3; brief §50, §62).
 *
 * <h3>Negative controls — run, OBSERVED RED, restored</h3>
 *
 * 1. Set a migrated call site's `confirmLabel` to `"OK"` → "the confirm label restates the verb"
 *    red, naming the file. Restored.
 * 2. Removed `aria-modal="true"` from `dialog.tsx` → "every dialog surface is modal" red.
 *    Restored.
 * 3. Reinstated the bespoke `<Dialog>` confirmation in `stations/page.tsx` → "the six bespoke
 *    confirmations are gone" red, naming stations. Restored.
 */

const ROOT = frontendRoot();

/** The five tenant-side sites 38-03 migrated. */
const MIGRATED = [
  "app/(tenant)/app/stations/page.tsx",
  "app/(tenant)/app/inventory/categories/page.tsx",
  "app/(tenant)/app/inventory/ingredients/page.tsx",
  "app/(tenant)/app/inventory/setup/page.tsx",
  "app/(tenant)/app/purchasing/vendors/[id]/page.tsx",
];

const read = (file: string) => readFileSync(resolve(ROOT, file), "utf8");

describe("ConfirmDialog — behaviour", () => {
  function renderDialog(props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title='Archive "Chicken"?'
        body="Existing recipes keep referencing it."
        confirmLabel="Archive ingredient"
        onConfirm={onConfirm}
        {...props}
      />,
    );
    return { onConfirm, onOpenChange };
  }

  it("names the object in the title and the consequence in the body", () => {
    // UI-SPEC §8.3: never "Are you sure?".
    renderDialog();
    expect(screen.getByText('Archive "Chicken"?')).toBeInTheDocument();
    expect(screen.getByText("Existing recipes keep referencing it.")).toBeInTheDocument();
  });

  it("confirms through the labelled verb", async () => {
    const { onConfirm } = renderDialog();
    await userEvent.setup().click(screen.getByRole("button", { name: "Archive ingredient" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("shows a pending label and disables both buttons while in flight", () => {
    renderDialog({ isPending: true, pendingLabel: "Archiving…" });
    expect(screen.getByTestId("confirm-dialog-confirm")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByText("Archiving…")).toBeInTheDocument();
  });

  it("renders a server refusal as an alert, above the buttons", () => {
    // The categories screen could not migrate without this: its refusal ("3 ingredients still
    // use this category") is the whole point of the interaction.
    renderDialog({ error: "3 ingredients still use this category." });
    expect(screen.getByRole("alert")).toHaveTextContent("3 ingredients still use this category.");
  });

  it("is announced as a modal dialog", () => {
    // Measured `null` on all three dialogs the audit probed, including the command palette.
    renderDialog();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  });
});

describe("ConfirmDialog — the six bespoke implementations are gone (G4)", () => {
  it.each(MIGRATED)("%s uses the shared primitive", (file) => {
    const source = read(file);
    expect(source, `${file} does not import ConfirmDialog`).toContain(
      "@/components/ui/confirm-dialog",
    );
    // The tell for a bespoke confirmation: a raw Dialog with a footer of its own.
    expect(source, `${file} still hand-rolls a confirmation Dialog`).not.toMatch(/<DialogFooter\b/);
  });

  it("there is exactly one ConfirmDialog implementation", () => {
    expect(existsSync(resolve(ROOT, "components/ui/confirm-dialog.tsx"))).toBe(true);
    for (const gone of [
      "components/purchasing/ConfirmDialog.tsx",
      "components/inventory/ConfirmDialog.tsx",
    ]) {
      expect(existsSync(resolve(ROOT, gone)), `${gone} should not exist`).toBe(false);
    }
  });

  it.each(MIGRATED)("%s's confirm label restates the verb", (file) => {
    // Brief §50 / UI-SPEC §8.2: the button says what will happen, never `OK`.
    const labels = [...read(file).matchAll(/confirmLabel="([^"]+)"/g)].map((m) => m[1]!);
    expect(labels.length, `${file} passes no confirmLabel`).toBeGreaterThan(0);
    for (const label of labels) {
      expect(
        NON_ANSWER_LABELS.includes(label.trim().toLowerCase()),
        `${file} uses the non-answer label "${label}"`,
      ).toBe(false);
    }
  });
});

describe("every dialog surface is modal (UI-SPEC §11)", () => {
  it("dialog.tsx sets aria-modal, so the palette and every consumer inherit it", () => {
    // Asserted on the SOURCE as well as on a render, because the palette does not mount in this
    // suite and its `aria-modal` comes from this one shared component.
    expect(read("components/ui/dialog.tsx")).toContain('aria-modal="true"');
  });
});
