import { motion, useReducedMotion } from "framer-motion";
import { EASE_OUT } from "./motion.js";

type Tone = "brand" | "ok" | "warn" | "danger";

/** Horizontal bullet-style meter — value is always rendered as text, never color-only (WCAG). */
export function Meter({ label, value, max, format, tone = "brand" }: { label: string; value: number; max: number; format?: (v: number) => string; tone?: Tone }) {
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const reduceMotion = useReducedMotion();
  const cls = tone === "brand" ? "meter" : `meter meter--${tone}`;
  return (
    <div className={cls}>
      <div className="meter__row">
        <span className="meter__label">{label}</span>
        <span className="meter__value">{format ? format(value) : value.toLocaleString()}</span>
      </div>
      <div className="meter__track">
        <motion.div
          className="meter__fill"
          initial={{ width: reduceMotion ? `${pct * 100}%` : 0 }}
          animate={{ width: `${pct * 100}%` }}
          transition={{ duration: 0.6, ease: EASE_OUT }}
        />
      </div>
    </div>
  );
}

/** Circular ring gauge (e.g. uptime %) — center label always shows the exact number. */
export function RingGauge({ value, size = 56, stroke = 5, tone = "ok", label }: { value: number; size?: number; stroke?: number; tone?: Tone; label?: string }) {
  const reduceMotion = useReducedMotion();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, Math.max(0, value / 100));
  const cls = tone === "brand" ? "ring" : `ring ring--${tone}`;
  return (
    <span className={cls} style={{ width: size, height: size }} role="img" aria-label={label ?? `${value}%`}>
      <svg width={size} height={size} aria-hidden="true">
        <circle className="ring__track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <motion.circle
          className="ring__fill"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeDasharray={c}
          initial={{ strokeDashoffset: reduceMotion ? c * (1 - pct) : c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 0.8, ease: EASE_OUT }}
        />
      </svg>
      <span className="ring__label">{value.toFixed(value % 1 === 0 ? 0 : 1)}%</span>
    </span>
  );
}
