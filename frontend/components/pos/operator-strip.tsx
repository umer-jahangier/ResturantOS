"use client";

import Link from "next/link";
import { Building2, CircleAlert, CircleCheck, CircleDashed, CircleSlash, LogOut } from "lucide-react";

import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useMyBranches } from "@/lib/hooks/auth/use-my-branches";
import { useActiveTill } from "@/lib/hooks/pos/use-till";
import { cn } from "@/lib/utils";

/**
 * Does this route get the operator shell instead of the back office (UI-SPEC §9.2, §4.1)?
 *
 * <p>Path prefix rather than a context flag, and deliberately so: a layout renders ABOVE the
 * page, so by the time a page could set a flag the sidebar has already mounted, measured and
 * been photographed. The prefix covers the whole POS family — terminal, charge, receipt, tills —
 * because they are one uninterrupted operator task and the chrome must not flicker between them.
 *
 * <p>`/app/pos` exactly, or anything beneath it. Written as a boundary check rather than a bare
 * `startsWith` so a future `/app/postmortem` cannot silently lose its navigation.
 */
export function isOperatorRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return pathname === "/app/pos" || pathname.startsWith("/app/pos/");
}

/**
 * The operator chrome for `app/(tenant)/app/pos/**` (UI-SPEC §9.2, §4.1; plan 38-04 task 1).
 *
 * <h3>Why the back-office shell cannot stay on a terminal</h3>
 *
 * Measured on the live route: a 255px sidebar, a breadcrumb reading `App › POS`, a global search
 * box and a notification bell — none of which a cashier uses, all of which are between their
 * thumb and the menu. UI-SPEC §4.1 calls replacing them *"the single biggest structural change"*
 * in the phase. This strip is the replacement: **56px**, four things, and it reclaims the whole
 * 255px column for tiles.
 *
 * The four things are the four a cashier actually needs mid-shift, and no others:
 * **which branch am I ringing against · is my drawer open · who am I signed in as · how do I get
 * out**. There is no navigation here on purpose — a terminal is a destination, not a hub, and the
 * Exit link is the one way back to the back office.
 *
 * <h3>What this file may not do</h3>
 *
 * This is `operational` (D-38-04). Depth cues only: **no `backdrop-filter`, no entrance
 * animation, no transform**. That is not a frame-rate preference. `receipt-print.css:180` lifts
 * the bill out of the app with `position: fixed`, and a `transform`, `filter`, `backdrop-filter`,
 * `perspective`, `will-change` or `contain` on ANY ancestor of `.receipt-root` makes that ancestor
 * the containing block for its fixed descendants — **at print time too**. This strip renders above
 * the receipt route, so a decorative filter here prints the application onto a customer's bill.
 * Six lines of CSS, two gates.
 *
 * <h3>Colour is never the only channel (§4.2 / D-38-13)</h3>
 *
 * The till chip carries its state three ways — a distinct icon SHAPE, literal words, and hue — so
 * it survives a protanopic reader, a sun-bleached counter screen and a monochrome remote session.
 */
export function OperatorStrip() {
  const { userId, branchId, roles } = useCurrentUser();
  const branchesQuery = useMyBranches();
  const tillQuery = useActiveTill();

  const branchName =
    branchesQuery.data?.find((branch) => branch.id === branchId)?.name ?? null;

  /*
   * Three states and a fourth that is NOT one of them.
   *
   * `isError` is read before `data`, and that ordering is the whole of S1-09 repeated here: a
   * failed till read and a resolved "no open till" both leave `data` undefined, so a chip that
   * only looked at `data` would tell a cashier their drawer was closed while the till service was
   * merely unreachable. Those are opposite instructions for the person holding the queue.
   */
  const till: TillChipState = tillQuery.isError
    ? "unavailable"
    : tillQuery.isLoading
      ? "unknown"
      : tillQuery.data && tillQuery.data.status === "OPEN"
        ? "open"
        : "closed";

  return (
    <header
      data-testid="pos-operator-strip"
      className="flex h-14 shrink-0 items-center gap-2 border-b bg-surface-2 px-3"
    >
      {/* Branch — read-only. A branch SWITCHER on a terminal would let a cashier move scope
          mid-till, which is how takings land against the wrong shop. Switching stays in the
          back office, behind Exit. */}
      <span
        data-testid="pos-operator-branch"
        className="flex min-w-0 items-center gap-1.5 text-pos font-medium"
      >
        <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate">
          {branchName ?? (branchesQuery.isLoading ? "Loading branch…" : "No branch")}
        </span>
      </span>

      <TillChip state={till} />

      <span className="ml-auto" />

      {/* Who is ringing. Deliberately NOT a control: it is the one identity fact a cashier needs
          and every extra target on this strip is one more thing to hit by mistake at speed. */}
      <span
        data-testid="pos-operator-user"
        className="flex items-center gap-2 text-small text-muted-foreground"
      >
        <span
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-full bg-muted font-medium text-foreground"
        >
          {userId ? userId.slice(0, 1).toUpperCase() : "U"}
        </span>
        <span className="hidden sm:inline">{roles[0] ?? "Operator"}</span>
      </span>

      {/*
        No theme toggle here, and it was considered rather than forgotten. The plan names four
        things for this strip and a fifth control is a fifth thing to hit by mistake at speed; the
        theme is a per-browser preference that persists once set anywhere in the product, so it is
        not lost by being absent from the terminal — only from the terminal. If a counter screen
        in daylight turns out to need it on the route itself, it belongs behind Exit, not beside
        Close Till.
      */}
      <Link
        href="/app/dashboard"
        data-testid="pos-operator-exit"
        className="touch-target inline-flex items-center gap-1.5 rounded-md border px-3 text-small font-medium hover:bg-accent"
      >
        <LogOut className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">Exit</span>
      </Link>
    </header>
  );
}

type TillChipState = "open" | "closed" | "unavailable" | "unknown";

const TILL_CHIP: Record<
  TillChipState,
  { label: string; short: string; Icon: typeof CircleCheck; tone: string }
> = {
  open: { label: "Till open", short: "Open", Icon: CircleCheck, tone: "text-success" },
  closed: { label: "Till closed", short: "Closed", Icon: CircleSlash, tone: "text-warning" },
  unavailable: {
    label: "Till unavailable",
    short: "No till read",
    Icon: CircleAlert,
    tone: "text-destructive",
  },
  // Not "closed". While the read is in flight the honest answer is that we do not know yet, and
  // a chip that guesses "closed" for half a second sends the cashier to press Open Till.
  unknown: { label: "Checking till…", short: "Checking…", Icon: CircleDashed, tone: "text-muted-foreground" },
};

function TillChip({ state }: { state: TillChipState }) {
  const { label, short, Icon, tone } = TILL_CHIP[state];
  return (
    <span
      role="status"
      data-testid="pos-operator-till"
      data-till-state={state}
      className={cn("flex shrink-0 items-center gap-1.5 text-small font-medium", tone)}
    >
      <Icon className="size-4" aria-hidden="true" />
      {/*
        The short form is written out rather than derived by trimming "Till ", which produced a
        lowercase "open" sitting next to the branch name at 390px and read as a sentence fragment.
        A phone still gets a whole word.
      */}
      <span className="hidden md:inline">{label}</span>
      <span className="md:hidden">{short}</span>
    </span>
  );
}
