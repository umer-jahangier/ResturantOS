"use client";

import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { fadeSlideUp } from "@/lib/motion/variants";

interface PageTransitionMotionProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * The actual framer-motion wrapper. Loaded client-only via next/dynamic from
 * PageTransition so it never participates in SSR/hydration — framer-motion
 * applies `initial` styles on the client but not during SSR, which otherwise
 * produces a className/style hydration mismatch on the wrapped element.
 */
export default function PageTransitionMotion({ children, className }: PageTransitionMotionProps) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        variants={fadeSlideUp}
        initial="initial"
        animate="animate"
        exit="exit"
        className={className}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
