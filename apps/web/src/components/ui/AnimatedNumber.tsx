import { useEffect, useRef } from "react";
import { animate, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
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
  const spanRef = useRef<HTMLSpanElement>(null);
  const first = useRef(true);

  useEffect(() => {
    const from = first.current ? 0 : mv.get();
    first.current = false;
    if (reduceMotion) {
      mv.set(value);
      return;
    }
    const controls = animate(from, value, { duration: 0.6, ease: EASE_OUT });
    return controls.stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduceMotion]);

  useEffect(() => rounded.on("change", (v) => { if (spanRef.current) spanRef.current.textContent = String(v); }), [rounded]);

  return <span ref={spanRef}>0</span>;
}
