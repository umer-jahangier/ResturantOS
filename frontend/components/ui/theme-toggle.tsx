"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";

type Theme = "light" | "dark" | "system";

const CYCLE: Theme[] = ["light", "dark", "system"];

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
  const currentIdx = CYCLE.indexOf(current);
  const nextTheme = CYCLE[(currentIdx + 1) % CYCLE.length];

  function handleClick() {
    setTheme(nextTheme ?? "system");
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={LABELS[current]}
      className="touch-target inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {ICONS[current]}
    </button>
  );
}
