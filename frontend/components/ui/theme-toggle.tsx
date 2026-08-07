"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "@teispace/next-themes";
import { Monitor, Moon, Sun } from "lucide-react";

export type Theme = "light" | "dark" | "system";

const CYCLE: Theme[] = ["light", "dark", "system"];

/**
 * The next theme in the light → dark → system cycle.
 *
 * <p>Exported because the command palette offers "Toggle theme" too, and GA-092 found that entry
 * doing nothing at all. Two controls with the same name must move the theme the same way, so they
 * share this function rather than each carrying their own idea of what "toggle" means — a binary
 * flip in the palette would have skipped `system` and silently disagreed with the header button
 * sitting three pixels away.
 */
export function nextThemeInCycle(current: string | undefined): Theme {
  const idx = CYCLE.indexOf((current as Theme) ?? "system");
  return CYCLE[(idx + 1) % CYCLE.length] ?? "system";
}

const ICONS: Record<Theme, React.ReactNode> = {
  light: <Sun className="size-4" />,
  dark: <Moon className="size-4" />,
  system: <Monitor className="size-4" />,
};

const LABELS: Record<Theme, string> = {
  light: "Switch to dark mode",
  dark: "Switch to system mode",
  system: "Switch to light mode",
};

const noop = () => () => {};
const getTrue = () => true;
const getFalse = () => false;

/**
 * Cycles light → dark → system. Uses useSyncExternalStore for SSR-safe
 * hydration without useEffect (satisfies react-hooks/set-state-in-effect rule).
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(noop, getTrue, getFalse);

  if (!mounted) {
    return (
      <button
        className="touch-target inline-flex items-center justify-center rounded-md p-2 text-muted-foreground"
        aria-label="Toggle theme"
        disabled
      >
        <Monitor className="size-4" />
      </button>
    );
  }

  const current = (theme as Theme) ?? "system";

  function handleClick() {
    setTheme(nextThemeInCycle(theme));
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={LABELS[current]}
      className="touch-target inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      {ICONS[current]}
    </button>
  );
}
