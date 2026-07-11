import { useEffect } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { EASE_OUT } from "./motion.js";

/**
 * Count-up number for stat cards. Animates from the previous value to the next
 * whenever `value` changes (mount included) — a tasteful, grounded-in-real-data
 * micro-interaction, not decoration. Respects prefers-reduced-motion by jumping
 * straight to the target.
 */
export function AnimatedNumber({ value, formatter }: { value: number; formatter?: (n: number) => string }) {
  const reduceMotion = useReducedMotion();
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) => (formatter ? formatter(Math.round(v)) : Math.round(v).toLocaleString()));

  useEffect(() => {
    if (reduceMotion) {
      mv.set(value);
      return;
    }
    // animate(motionValue, to) always tweens from the value's current position,
    // so re-renders naturally continue from wherever the last animation landed.
    const controls = animate(mv, value, { duration: 0.6, ease: EASE_OUT });
    return controls.stop;
  }, [value, reduceMotion, mv]);

  return <motion.span>{rounded}</motion.span>;
}
