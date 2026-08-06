"use client";

import React from "react";
import { useReducedMotion } from "framer-motion";
import PageTransitionMotion from "./page-transition-motion";

interface PageTransitionProps {
  children: React.ReactNode;
  className?: string;
}

// Same SSR-safe "have we hydrated yet?" read as components/ui/theme-toggle.tsx: the
// server snapshot is false and the client snapshot is true, so React reports false
// through hydration and true immediately after — without a setState inside an effect.
const noop = () => () => {};
const getTrue = () => true;
const getFalse = () => false;

export function PageTransition({ children, className }: PageTransitionProps) {
  const prefersReducedMotion = useReducedMotion();
  const mounted = React.useSyncExternalStore(noop, getTrue, getFalse);

  // On the server and the first client paint, render a plain, stable wrapper so
  // the hydrated tree matches the server exactly. framer-motion applies its
  // `initial` styles on the client but not during SSR, so mounting the motion
  // wrapper only after hydration is the only way to avoid a className/style
  // hydration mismatch. Children are always rendered, so SSR content is intact.
  if (!mounted || prefersReducedMotion) {
    return <div className={className}>{children}</div>;
  }

  return <PageTransitionMotion className={className}>{children}</PageTransitionMotion>;
}
