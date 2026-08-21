import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { Avatar, AVATAR_TONES, avatarInitials, avatarToneIndex } from "@/components/ui/avatar";

/**
 * `Avatar` (N8) — the shared initials disc the demo draws 10×, 9× inside a table cell.
 *
 * <h3>What these tests are actually defending</h3>
 *
 * The three properties that make this primitive adoptable, each of which fails silently in
 * production if it regresses:
 *
 * 1. **It is not a button.** Its only existing call site (`top-bar.tsx:258`) is a
 *    `DropdownMenuTrigger`. If `Avatar` ever renders an interactive element it becomes
 *    un-adoptable there — nested interactives — and nobody finds out from a type error.
 * 2. **Determinism.** A tone that moves between the server render and hydration is a hydration
 *    mismatch on nine cells per page, and looks like a flicker rather than like a bug.
 * 3. **Silent by default.** An avatar beside a name that announces its initials makes a screen
 *    reader read every table row twice.
 *
 * <h3>Negative controls — run, OBSERVED RED, restored</h3>
 *
 * 1. Tone hash swapped for `Math.floor(Math.random() * AVATAR_TONES.length)`
 *    → RED, **5 failures**: "gives the same name the same tone on every call", "ignores case and
 *    whitespace", "matches a recorded vector", "spreads a realistic staff roster", and
 *    "renders identically on repeated mounts". Restored.
 * 2. `label`-absent branch dropped so the wrapper always carried `role="img"`
 *    → RED: "is aria-hidden when the person's name is adjacent (the 9-in-a-table case)".
 *    Restored.
 * 3. `"from-emerald-400 to-emerald-600"` added as a ninth tone → RED here ("uses only brand ramp
 *    steps…", "never uses a stop darker than -500", and the vector test, since a ninth bucket
 *    re-colours everyone) AND independently RED in `conformance.test.ts`:
 *    "G3: these files are absent from the baseline and must score zero". Restored.
 * 4. `SIZE_CLASSES.md` changed from `text-label` to `text-sm` → RED here ("spells its type role
 *    from the contract scale") AND RED in `conformance.test.ts` twice —
 *    "components/ui/avatar.tsx: 1" as a new G1 offender, and "expected 1086 to be less than or
 *    equal to 1085" against the recorded high-water mark. Restored.
 */

describe("avatarInitials", () => {
  it("takes the first letter of the first and last name", () => {
    // The demo's own example: "Ahmed Raza" → "AR" (NEXUS_ERP_Demo.html:135).
    expect(avatarInitials("Ahmed Raza")).toBe("AR");
  });

  it("skips the middle names rather than growing", () => {
    expect(avatarInitials("Muhammad Ali Jinnah")).toBe("MJ");
  });

  it("returns ONE letter for a single-token name, never an invented second", () => {
    // "AH" would be a letter the avatar made up, beside a row that says "Ahmed".
    expect(avatarInitials("Ahmed")).toBe("A");
  });

  it("normalises case and surrounding whitespace", () => {
    expect(avatarInitials("  ahmed   raza  ")).toBe("AR");
  });

  it("splits by code point, so a non-BMP name does not lose half a character", () => {
    const initials = avatarInitials("\u{1D49C}lpha Beta");
    expect(initials.startsWith("\u{1D49C}")).toBe(true);
    expect(Array.from(initials)).toHaveLength(2);
  });

  it("returns nothing for a name it cannot take a letter from", () => {
    expect(avatarInitials("   ")).toBe("");
    expect(avatarInitials("")).toBe("");
  });
});

describe("avatarToneIndex — deterministic, everywhere", () => {
  it("is in range for a wide spread of names", () => {
    for (let i = 0; i < 500; i += 1) {
      const index = avatarToneIndex(`Person Number ${i}`);
      expect(Number.isInteger(index)).toBe(true);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(AVATAR_TONES.length);
    }
  });

  it("gives the same name the same tone on every call", () => {
    const first = avatarToneIndex("Ahmed Raza");
    for (let i = 0; i < 50; i += 1) expect(avatarToneIndex("Ahmed Raza")).toBe(first);
  });

  it("ignores case and whitespace, so one person is one colour", () => {
    expect(avatarToneIndex("  AHMED   raza ")).toBe(avatarToneIndex("Ahmed Raza"));
  });

  it("matches a recorded vector, which is what pins it across processes and machines", () => {
    // FNV-1a is fully specified, so these values are reproducible rather than snapshotted from
    // whatever this machine happened to produce. If the hash is ever swapped, this goes red and
    // the swap is a deliberate, reviewed re-colouring of every existing person.
    expect(avatarToneIndex("ahmed raza")).toBe(2);
    expect(avatarToneIndex("bilal khan")).toBe(3);
    expect(avatarToneIndex("usman tariq")).toBe(6);
    expect(avatarToneIndex("")).toBe(0);
  });

  it("spreads a realistic staff roster across most of the tone set", () => {
    // Not a uniformity proof — a hash of 12 names into 8 buckets cannot fill all 8 — but it
    // catches the failure that matters: a hash that collapses everyone onto one colour.
    const roster = [
      "Ahmed Raza", "Sana Malik", "Bilal Khan", "Ayesha Noor", "Usman Tariq", "Hira Shah",
      "Zain Abbas", "Fatima Iqbal", "Omar Siddiqui", "Nida Farooq", "Hassan Ali", "Mariam Yousaf",
    ];
    const used = new Set(roster.map(avatarToneIndex));
    expect(used.size).toBeGreaterThanOrEqual(5);
  });
});

describe("AVATAR_TONES — the contrast argument holds for ALL of them", () => {
  it("uses only brand ramp steps, never a state hue and never a raw palette literal", () => {
    // Gold + teal only. `success`/`warning`/`danger`/`info` would make an identity look like a
    // state (D-38-12 records the same constraint for the secondary ramp).
    for (const tone of AVATAR_TONES) {
      for (const stop of tone.split(" ")) {
        expect(stop).toMatch(/^(?:from|to)-(?:primary|secondary)-\d{3}$/);
      }
    }
  });

  it("never uses a stop darker than -500, which is the measured AA boundary", () => {
    // Measured with the repo's colorjs.io against --primary-solid-foreground in both themes:
    // -500 = 6.20:1 light / 7.30:1 dark; -600 = 4.31:1 light and therefore FAILS.
    for (const tone of AVATAR_TONES) {
      for (const step of tone.matchAll(/-(\d{3})$/gm)) {
        expect(Number(step[1])).toBeLessThanOrEqual(500);
      }
    }
    for (const tone of AVATAR_TONES) {
      const steps = tone.split(" ").map((s) => Number(s.slice(s.lastIndexOf("-") + 1)));
      expect(Math.max(...steps)).toBeLessThanOrEqual(500);
      expect(Math.min(...steps)).toBeGreaterThanOrEqual(200);
    }
  });

  it("has no duplicate tones", () => {
    expect(new Set(AVATAR_TONES).size).toBe(AVATAR_TONES.length);
  });
});

describe("Avatar — rendering", () => {
  it("renders the initials, not the whole name", () => {
    render(<Avatar name="Ahmed Raza" label="Ahmed Raza" />);
    expect(screen.getByTestId("avatar-initials")).toHaveTextContent("AR");
  });

  it("is NOT an interactive element, so it can compose inside the profile-menu button", () => {
    const { container } = render(<Avatar name="Ahmed Raza" label="Ahmed Raza" />);
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    const root = container.querySelector('[data-slot="avatar"]')!;
    expect(root.tagName).toBe("SPAN");
    expect(root.getAttribute("tabindex")).toBeNull();
  });

  it("renders identically on repeated mounts — the tone class does not move", () => {
    const first = render(<Avatar name="Ahmed Raza" />).container.innerHTML;
    const second = render(<Avatar name="Ahmed Raza" />).container.innerHTML;
    expect(second).toBe(first);
  });

  it("gives two different people two different discs, but by class not by inline style", () => {
    // Inline `style=` gradients are exactly what the demo did nine times, and why it has seven
    // uncatalogued avatar colours. Tones stay in the token layer.
    const { container } = render(
      <>
        <Avatar name="Ahmed Raza" />
        <Avatar name="Usman Tariq" />
      </>,
    );
    const discs = Array.from(container.querySelectorAll('[data-slot="avatar"]'));
    expect(discs).toHaveLength(2);
    expect(discs[0]!.getAttribute("data-tone")).not.toBe(discs[1]!.getAttribute("data-tone"));
    for (const disc of discs) expect(disc.getAttribute("style")).toBeNull();
  });

  it("honours toneKey, so one person under two spellings keeps one colour", () => {
    const { container: a } = render(<Avatar name="Ahmed Raza" toneKey="user-7" />);
    const { container: b } = render(<Avatar name="A. Raza" toneKey="user-7" />);
    expect(a.querySelector('[data-slot="avatar"]')!.getAttribute("data-tone")).toBe(
      b.querySelector('[data-slot="avatar"]')!.getAttribute("data-tone"),
    );
  });

  it("falls back to a glyph, not to a fabricated character, when there is no letter", () => {
    render(<Avatar name="   " label="Unassigned" />);
    expect(screen.getByTestId("avatar-glyph")).toBeInTheDocument();
    expect(screen.queryByTestId("avatar-initials")).toBeNull();
  });
});

describe("Avatar — the photograph and its fallback", () => {
  it("shows the image when one is given", () => {
    render(<Avatar name="Ahmed Raza" src="https://example.test/a.jpg" label="Ahmed Raza" />);
    expect(screen.getByTestId("avatar-image")).toHaveAttribute("src", "https://example.test/a.jpg");
    expect(screen.queryByTestId("avatar-initials")).toBeNull();
  });

  it("falls back to the initials on a load failure — never a broken-image glyph", () => {
    render(<Avatar name="Ahmed Raza" src="https://example.test/gone.jpg" label="Ahmed Raza" />);
    fireEvent.error(screen.getByTestId("avatar-image"));
    expect(screen.queryByTestId("avatar-image")).toBeNull();
    expect(screen.getByTestId("avatar-initials")).toHaveTextContent("AR");
  });

  it("retries a NEW src after a failure, rather than staying broken for the mount", () => {
    const { rerender } = render(
      <Avatar name="Ahmed Raza" src="https://example.test/gone.jpg" label="Ahmed Raza" />,
    );
    fireEvent.error(screen.getByTestId("avatar-image"));
    expect(screen.queryByTestId("avatar-image")).toBeNull();
    rerender(<Avatar name="Ahmed Raza" src="https://example.test/new.jpg" label="Ahmed Raza" />);
    expect(screen.getByTestId("avatar-image")).toHaveAttribute("src", "https://example.test/new.jpg");
  });

  it("treats a null src as no photograph at all", () => {
    render(<Avatar name="Ahmed Raza" src={null} label="Ahmed Raza" />);
    expect(screen.queryByTestId("avatar-image")).toBeNull();
    expect(screen.getByTestId("avatar-initials")).toHaveTextContent("AR");
  });
});

describe("Avatar — accessibility (D-38-13)", () => {
  it("is aria-hidden when the person's name is adjacent (the 9-in-a-table case)", () => {
    const { container } = render(
      <span>
        <Avatar name="Ahmed Raza" />
        <span>Ahmed Raza</span>
      </span>,
    );
    const root = container.querySelector('[data-slot="avatar"]')!;
    expect(root).toHaveAttribute("aria-hidden", "true");
    expect(root).not.toHaveAttribute("role");
    // The initials must not be announced as letters on top of the name beside them.
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("becomes a labelled role=img when it stands alone", () => {
    render(<Avatar name="Ahmed Raza" label="Ahmed Raza, Super Admin" />);
    const img = screen.getByRole("img", { name: "Ahmed Raza, Super Admin" });
    expect(img).toBeInTheDocument();
    expect(img).not.toHaveAttribute("aria-hidden");
  });

  it("keeps the photograph out of the accessibility tree either way", () => {
    // role="img" + aria-label owns the name; a second alt would announce the person twice.
    render(<Avatar name="Ahmed Raza" src="https://example.test/a.jpg" label="Ahmed Raza" />);
    const img = screen.getByTestId("avatar-image");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("aria-hidden", "true");
  });

  it("carries a focus affordance that needs no cooperation from the parent control", () => {
    // No `group/` class to remember at the call site — a hook a call site can forget is a hook
    // that will be forgotten, and `top-bar.tsx` is owned by another wave and cannot be edited.
    const { container } = render(<Avatar name="Ahmed Raza" />);
    const cls = container.querySelector('[data-slot="avatar"]')!.className;
    expect(cls).toContain("[button:focus-visible_&]:ring-2");
    expect(cls).toContain("[a:focus-visible_&]:ring-2");
  });
});

describe("Avatar — design-system contract (gates G1-G3)", () => {
  const sizes = ["sm", "md", "lg"] as const;

  it("spells its type role from the contract scale, never Tailwind's stock scale", () => {
    for (const size of sizes) {
      const { container } = render(<Avatar name="Ahmed Raza" size={size} />);
      const cls = container.querySelector('[data-slot="avatar"]')!.className;
      expect(cls).toMatch(/\btext-(?:label|small)\b/);
      expect(cls).not.toMatch(/\btext-(?:xs|sm|base|lg|xl|2xl|3xl)\b/);
    }
  });

  it("uses the radius ladder, never a bare `rounded`", () => {
    const { container } = render(<Avatar name="Ahmed Raza" />);
    const cls = container.querySelector('[data-slot="avatar"]')!.className;
    expect(cls).toContain("rounded-full");
    expect(cls).not.toMatch(/\brounded(?![-\w])/);
  });

  it("fills with the FILL role, not the text/link role", () => {
    // `--primary` renders bronze in light mode and is the TEXT role; `--primary-solid` is the
    // gold FILL role in both themes. `bg-primary` here would be a quiet light-mode regression.
    const { container } = render(<Avatar name="Ahmed Raza" />);
    const cls = container.querySelector('[data-slot="avatar"]')!.className;
    expect(cls).toContain("bg-primary-solid");
    expect(cls).toContain("text-primary-solid-foreground");
    expect(cls).not.toMatch(/bg-primary(?![-\w])/);
  });

  it("fits a 32px table cell at the default size and matches the top bar", () => {
    // top-bar.tsx:258 is `size-8`; the demo's table avatars are 28-30px.
    const { container } = render(<Avatar name="Ahmed Raza" />);
    expect(container.querySelector('[data-slot="avatar"]')!.className).toContain("size-8");
  });

  it("never shrinks inside a flex table cell", () => {
    const { container } = render(<Avatar name="Ahmed Raza" />);
    expect(container.querySelector('[data-slot="avatar"]')!.className).toContain("shrink-0");
  });

  it("is safe on an operational surface with no opt-in (D-38-04)", () => {
    // No backdrop-filter, no entrance animation, no parallax, no tilt — so a POS or KDS screen
    // cannot acquire any of them by using the shared avatar.
    const { container } = render(<Avatar name="Ahmed Raza" src="https://example.test/a.jpg" />);
    const html = container.innerHTML;
    expect(html).not.toMatch(/backdrop-blur|backdrop-filter|glass-surface/);
    expect(html).not.toMatch(/\banimate-|vdl-lift|vdl-stagger|motion-/);
  });

  it("accepts a className without losing its own", () => {
    const { container } = render(<Avatar name="Ahmed Raza" className="ml-(--space-xs)" />);
    const cls = container.querySelector('[data-slot="avatar"]')!.className;
    expect(cls).toContain("ml-(--space-xs)");
    expect(cls).toContain("rounded-full");
  });
});
