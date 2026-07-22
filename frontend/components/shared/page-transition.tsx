"use client";

import React from "react";
import { useReducedMotion } from "framer-motion";
import PageTransitionMotion from "./page-transition-motion";

interface PageTransitionProps {
  children: React.ReactNode;
  className?: string;
}

export function PageTransition({ children, className }: PageTransitionProps) {
  const prefersReducedMotion = useReducedMotion();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // On the server and the first client paint, render a plain, stable wrapper so
  // the hydrated tree matches the server exactly. framer-motion applies its
  // `initial` styles on the client but not during SSR, so mounting the motion
  // wrapper only after hydration is the only way to avoid a className/style
  // hydration mismatch. Children are always rendered, so SSR content is intact.
  if (!mounted || prefersReducedMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <PageTransitionMotion className={className}>{children}</PageTransitionMotion>
  );
}
