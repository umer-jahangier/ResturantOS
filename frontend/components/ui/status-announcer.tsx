"use client";

import { useCallback, useEffect, useRef, useState } from "react";

let globalSetMessage: ((message: string) => void) | null = null;

/**
 * The application's polite live region (UI-SPEC §11, plan 38-15 task 8).
 *
 * <h3>What task 8 asked to verify, and what the verification found</h3>
 *
 * The plan says: "`status-announcer.tsx` exists — verify every async result (save, delete, filter
 * change, row count change) announces once, and only once."
 *
 * <p>Measured: `grep -rn 'useStatusAnnouncer'` over `app/`, `components/` and `lib/` returns
 * **one** hit, and it is the declaration below. **This region has zero call sites.** Nothing in
 * the product announces through it. Every async result the plan lists reaches assistive tech —
 * where it reaches it at all — through Sonner's own live region, mounted beside this one in
 * `app-providers.tsx`. So the "and only once" half of the contract is currently satisfied by the
 * channel being empty, which is not the same thing as being satisfied, and is recorded here
 * rather than reported as a pass.
 *
 * <h3>The defect that was found in the primitive itself</h3>
 *
 * A live region announces a DOM MUTATION, not a function call. This component held the message in
 * a single piece of state and rendered it as text, so announcing the *same string twice in a row*
 * — "Saved", then "Saved" — set state to a value React compares as equal, re-rendered nothing,
 * mutated nothing, and announced nothing. The second save was silent. That is the exact inverse
 * of the "announces twice" defect the plan gates on, and it is just as wrong: a user who repeats
 * an action is told it worked once.
 *
 * <p>The fix is `key={seq}`. Every write increments a counter, so React replaces the text node
 * rather than diffing it into a no-op, and the region mutates on every call whether or not the
 * words changed. `aria-atomic="true"` then has the whole region re-read.
 *
 * <p>`role="status"` **and** `aria-live="polite"` are both present, and that is deliberate rather
 * than redundant-by-accident: `role="status"` carries the implicit live semantics older assistive
 * tech keys off, `aria-live` is what newer engines read, and specifying both is the documented
 * belt-and-braces. Two attributes on one node is not two regions and does not double an
 * announcement — the thing that would is a second `aria-live` ELEMENT carrying the same words,
 * which is why any future wiring of `announce()` must not also raise a toast saying them.
 */
export function StatusAnnouncer() {
  const [{ message, seq }, setState] = useState({ message: "", seq: 0 });

  useEffect(() => {
    globalSetMessage = (msg: string) => setState((prev) => ({ message: msg, seq: prev.seq + 1 }));
    return () => {
      globalSetMessage = null;
    };
  }, []);

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      <span key={seq} data-testid="status-announcer-message">
        {message}
      </span>
    </div>
  );
}

/**
 * Hook that returns an `announce` function. Call it to push a message to the
 * live region. The message is cleared after `clearAfterMs` (default 3000 ms).
 *
 * <p>The clear is not itself an announcement — removing content from a polite region causes
 * assistive tech to say nothing. It exists so that a screen-reader user who reaches the region by
 * rotor a minute later does not read a stale sentence about something that has finished.
 */
export function useStatusAnnouncer(clearAfterMs = 3000) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback(
    (message: string) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      globalSetMessage?.(message);
      timerRef.current = setTimeout(() => {
        globalSetMessage?.("");
      }, clearAfterMs);
    },
    [clearAfterMs],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return { announce };
}
