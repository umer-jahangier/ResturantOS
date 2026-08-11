"use client";

import * as React from "react";

/**
 * The richness zone a surface belongs to (phase 34, D-34-02).
 *
 * Three zones, and the whole phase hangs off keeping them apart:
 *
 * | Zone          | Screens                                                       | Treatment |
 * |---------------|---------------------------------------------------------------|-----------|
 * | `expressive`  | dashboards, reports, SuperAdmin console, onboarding, login, settings | full glass, depth, entrance + hover motion |
 * | `restrained`  | admin CRUD, lists, forms, menu management                     | subtle elevation, ≤150ms transitions, no decorative motion |
 * | `operational` | POS order screen, KDS/BDS board                               | depth cues only — NO backdrop-filter, NO entrance animation, NO parallax |
 *
 * The union type is deliberate: a fourth zone is a compile error rather than a
 * string typo that silently styles nothing.
 */
export type Zone = "expressive" | "restrained" | "operational";

/**
 * Defaults to `restrained`, which is the *safe* default in both directions — a
 * surface that forgot to declare itself gets subtle treatment rather than glass,
 * and it never gets less than a list page needs.
 */
const ZoneContext = React.createContext<Zone>("restrained");

/**
 * Read the zone of the surrounding surface.
 *
 * Portalled overlays (Radix mounts them on `document.body`) leave the zone
 * subtree entirely, so DOM ancestry cannot carry the zone to them and a
 * zone-scoped CSS rule written against ancestry would match nothing — present in
 * the stylesheet and absent on the screen. Those components read the zone through
 * this hook at the trigger's position in the React tree, which the portal
 * preserves, and stamp it onto the portalled node themselves.
 */
export function useZone(): Zone {
  return React.useContext(ZoneContext);
}

export interface ZoneProviderProps {
  zone: Zone;
  children: React.ReactNode;
  /** Element to render as the zone root. Defaults to a plain `div`. */
  as?: "div" | "section" | "main";
  className?: string;
  /**
   * Render no wrapper element at all and publish the zone through context only.
   * For zone roots whose owning element already exists and cannot tolerate an
   * extra box (the KDS board root is a full-height flex column, and the POS
   * terminal is another) — those stamp `data-zone` on their own element and use
   * this to publish the context half.
   */
  asChild?: boolean;
}

/**
 * Declares a richness zone through **two independent channels**: a `data-zone`
 * DOM attribute (which the cascade reads, so a zone-scoped rule in globals.css is
 * what keeps glass off the POS rather than developer discipline) and React
 * context (which portals preserve).
 *
 * Two channels, not one, because neither covers the other's blind spot: the
 * cascade cannot reach a node portalled outside the subtree, and context cannot
 * be read by a stylesheet.
 *
 * The wrapper is deliberately unstyled and establishes no block formatting or
 * stacking context. The POS terminal and the KDS board are both full-height flex
 * layouts, and an extra div with default styling breaks them — verified by
 * rendering both before and after.
 */
export function ZoneProvider({
  zone,
  children,
  as: Element = "div",
  className,
  asChild = false,
}: ZoneProviderProps) {
  if (asChild) {
    return <ZoneContext.Provider value={zone}>{children}</ZoneContext.Provider>;
  }

  return (
    <ZoneContext.Provider value={zone}>
      <Element data-zone={zone} className={className ?? "contents"}>
        {children}
      </Element>
    </ZoneContext.Provider>
  );
}

export { ZoneContext };
