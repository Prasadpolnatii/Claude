import type { Transition, Variants } from "framer-motion";

/**
 * Shared motion vocabulary — every animated surface in the app pulls from this
 * so entrances, hovers, and exits share one rhythm instead of ad-hoc tuning.
 * Framer Motion's `useReducedMotion` + `<MotionConfig reducedMotion="user">`
 * (wired in App.tsx) handles prefers-reduced-motion globally; these stay as
 * plain variants.
 */

export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export const springy: Transition = { type: "spring", stiffness: 420, damping: 34, mass: 0.7 };

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE_OUT } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.16, ease: EASE_OUT } },
};

export const fade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.24, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: 0.14 } },
};

/** Stagger container — children should use `fadeUp` or `listItem`. */
export const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045, delayChildren: 0.02 } },
};

export const listItem: Variants = {
  hidden: { opacity: 0, x: -8 },
  show: { opacity: 1, x: 0, transition: { duration: 0.28, ease: EASE_OUT } },
  exit: { opacity: 0, x: 8, height: 0, marginBottom: 0, transition: { duration: 0.18, ease: EASE_OUT } },
};

/** A newly-arrived real-time row (alerts feed): drop in from above with a brief highlight. */
export const arriveTop: Variants = {
  hidden: { opacity: 0, y: -14, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: springy },
  exit: { opacity: 0, scale: 0.97, transition: { duration: 0.18 } },
};

export const pageTransition: Variants = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE_OUT } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.12, ease: EASE_OUT } },
};
