"use client";

import { useState } from "react";
import { Check, Copy, Download, Printer, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { authLabelClass, authPrimaryButtonClass } from "@/components/auth/auth-chrome";

/**
 * The one and only presentation of a user's recovery codes.
 *
 * <h3>Why this is a checkpoint and not a notification</h3>
 *
 * The server stores SHA-256 digests and nothing else, so these strings exist in exactly one place:
 * this render. Once the component unmounts they are gone, and the user's only remedy is to
 * regenerate — which they cannot do if the reason they came looking is that they already lost the
 * authenticator. A toast or a dismissible banner would be the wrong shape for something with that
 * property, so the continue button stays disabled until the user ticks the acknowledgement. It is
 * mild friction bought against a permanent lockout.
 *
 * <h3>Three ways out, because one is not enough</h3>
 *
 * Copy, download and print. Copy is the one people reach for and the one that fails silently on a
 * page served without a secure context or when the clipboard permission is refused, which is why
 * the failure path here says what to do instead rather than a bare "couldn't copy". Download hands
 * over a plain `.txt` — no format anyone needs an app to open. Print exists because the correct
 * place to keep these is not on the machine that holds the password, and paper is the only option
 * this screen can offer that satisfies that.
 */
export function RecoveryCodesPanel({
  codes,
  accountLabel,
  onAcknowledged,
  continueLabel = "Continue",
}: {
  codes: string[];
  /** Written into the downloaded file so a user with two accounts can tell the lists apart. */
  accountLabel?: string;
  onAcknowledged: () => void;
  continueLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const fileBody = [
    "RestaurantOS — two-factor recovery codes",
    accountLabel ? `Account: ${accountLabel}` : null,
    `Generated: ${new Date().toISOString()}`,
    "",
    "Each code works once. Use one in place of your authenticator code if you",
    "lose access to your phone. Keep this somewhere other than the device you",
    "sign in from.",
    "",
    ...codes,
    "",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Use Download, or select the codes and copy them manually.");
    }
  }

  function download() {
    // A blob URL rather than a data: URI — Safari refuses to download the latter from a link, and
    // this is precisely the moment a silent no-op costs the user their codes.
    const url = URL.createObjectURL(new Blob([fileBody], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "restaurantos-recovery-codes.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function print() {
    const w = window.open("", "_blank", "width=600,height=700");
    if (!w) {
      toast.error("Your browser blocked the print window. Use Download instead.");
      return;
    }
    // Written as text into a fresh document rather than assembled as markup around the codes: the
    // codes come from our own generator, but a print path is not the place to introduce the habit
    // of interpolating values into an HTML string.
    w.document.title = "RestaurantOS recovery codes";
    const pre = w.document.createElement("pre");
    pre.style.font = "14px ui-monospace, SFMono-Regular, Menlo, monospace";
    pre.style.lineHeight = "1.8";
    pre.textContent = fileBody;
    w.document.body.appendChild(pre);
    w.focus();
    w.print();
  }

  return (
    <div className="grid gap-4" data-testid="recovery-codes-panel">
      <Alert className="items-start gap-x-3 border-warning/40 bg-warning/10 px-3.5 py-3">
        <ShieldAlert className="size-4 text-warning" />
        <AlertTitle className="text-body text-foreground">Save these recovery codes now</AlertTitle>
        <AlertDescription className="text-small">
          This is the only time they will be shown. Each one works once, in place of your
          authenticator code, if you lose your phone. Without them a lost phone means losing access
          to this account — nobody, including us, can read them back to you.
        </AlertDescription>
      </Alert>

      {/*
        The codes themselves, in the demo's mono voice — every reference and figure in this
        product is `--font-mono`, and a recovery code is the most reference-like string it has.
        Wide tracking because these are transcribed by hand off a screen onto paper more often
        than they are copied, and `O`/`0` and `I`/`1` are the whole failure mode there.
      */}
      <div className="grid gap-2 rounded-lg border border-border bg-surface-1 p-3">
        <p className={authLabelClass}>Your recovery codes</p>
        <ul className="grid grid-cols-2 gap-2" data-testid="recovery-codes-list">
          {codes.map((code) => (
            <li
              key={code}
              className="rounded-md border border-border bg-background px-2 py-2 text-center font-mono text-small tracking-[0.12em] text-foreground select-all"
            >
              {code}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={copyAll}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy all"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={download}>
          <Download className="size-4" />
          Download
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={print}>
          <Printer className="size-4" />
          Print
        </Button>
      </div>

      <label className="flex min-h-11 items-center gap-3 rounded-lg border border-border bg-surface-1 px-3.5 py-3 text-small text-foreground has-checked:border-primary/50 has-checked:bg-primary/8">
        <input
          type="checkbox"
          className="size-4.5 rounded-md border-border-interactive accent-primary"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          data-testid="recovery-codes-acknowledge"
        />
        <span>I have saved these codes somewhere safe.</span>
      </label>

      <Button
        type="button"
        onClick={onAcknowledged}
        disabled={!acknowledged}
        data-testid="recovery-codes-continue"
        className={authPrimaryButtonClass}
      >
        {continueLabel}
      </Button>
    </div>
  );
}
