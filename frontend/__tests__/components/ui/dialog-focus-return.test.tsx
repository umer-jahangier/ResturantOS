import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * WHERE FOCUS GOES WHEN A DIALOG CLOSES (WCAG 2.4.3).
 *
 * <h3>The defect this file was written for</h3>
 *
 * <p>Measured live against the deployment on 2026-08-22, sampling `document.activeElement` every
 * 25ms across the close: focus the ⌘K trigger, open the command palette, press Escape, and the
 * active element is `<body>`. The only focus event fired in the whole sequence was `focusout`
 * from the palette input — nothing received focus afterwards, so the next Tab restarts the
 * document from the top. The same probe on `/app/inventory/stock`'s "Opening balance" dialog
 * produced the identical reading, which is what established that this is not a command-palette
 * quirk but the behaviour of every dialog in the product.
 *
 * <h3>Why it happened</h3>
 *
 * <p>Radix's `DialogContentModal` composes an `onCloseAutoFocus` that calls `preventDefault()` —
 * disabling `FocusScope`'s restore-to-previously-focused — and then focuses
 * `context.triggerRef.current`. That ref is only populated by `<DialogTrigger>`. Nearly every
 * dialog in this codebase is CONTROLLED — a plain `<Button onClick={() => setOpen(true)}>` next
 * to an `<XDialog open={open} …/>` — so the ref is null, Radix focuses nothing, and the fallback
 * that would have worked has already been switched off.
 *
 * <h3>Negative control — run, OBSERVED RED, restored</h3>
 *
 * <p>With the `onOpenAutoFocus`/`onCloseAutoFocus` pair removed from `DialogContent`:
 * <b>2 failed, 1 passed</b>. Both restore cases went red on `expected … to have focus`; the one
 * that stayed green is the third, where the call site prevents the default and places focus
 * itself — it must behave identically with or without the fix, and it does, which is what proves
 * the escape hatch is still an escape hatch.
 *
 * <p>Worth recording that the `DialogTrigger` case failed too, because it contradicts the
 * obvious first theory. The defect is not merely "these dialogs forgot to use `DialogTrigger`":
 * Radix's `triggerRef` restore does not land here either. Whatever the cause, one default in
 * `DialogContent` covers both shapes, which is why the fix is there and not at the call sites.
 *
 * <p>Asserted in jsdom rather than only in the browser because 50 call sites depend on this
 * component and a unit test is the only thing that will run on every commit.
 */
describe("a dialog returns focus to whatever opened it", () => {
  function Controlled() {
    const [open, setOpen] = React.useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Opening balance
        </button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogTitle>Opening balance</DialogTitle>
            <DialogDescription>Record what this branch holds today.</DialogDescription>
            <input aria-label="Quantity" />
          </DialogContent>
        </Dialog>
      </>
    );
  }

  it("restores focus to a plain button that opened it, with no DialogTrigger anywhere", async () => {
    const user = userEvent.setup();
    render(<Controlled />);

    const opener = screen.getByRole("button", { name: "Opening balance" });
    opener.focus();
    expect(opener).toHaveFocus();

    await user.click(opener);
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // The whole finding, as one assertion: before the fix this was document.body.
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("still restores focus when there IS a DialogTrigger — the two paths agree", async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogTitle>Triggered</DialogTitle>
          <DialogDescription>Opened the Radix way.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    const trigger = screen.getByRole("button", { name: "Open" });
    await user.click(trigger);
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("lets a call site place focus itself — the default stands down when preventDefault is called", async () => {
    const user = userEvent.setup();

    function OwnRestore() {
      const [open, setOpen] = React.useState(false);
      const elsewhere = React.useRef<HTMLButtonElement>(null);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <button type="button" ref={elsewhere}>
            Next step
          </button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                elsewhere.current?.focus();
              }}
            >
              <DialogTitle>Wizard step</DialogTitle>
              <DialogDescription>Focus moves on rather than back.</DialogDescription>
            </DialogContent>
          </Dialog>
        </>
      );
    }

    render(<OwnRestore />);
    const opener = screen.getByRole("button", { name: "Open" });
    await user.click(opener);
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(screen.getByRole("button", { name: "Next step" })).toHaveFocus());
  });
});
