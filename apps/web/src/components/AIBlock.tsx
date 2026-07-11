import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, ChevronDown, ChevronUp, Lock, Pencil, Sparkle } from "lucide-react";
import type { GroundedResult } from "@ops-copilot/shared";
import { CONFIDENCE_FLOOR } from "@ops-copilot/shared";
import { fade } from "./ui/motion.js";

/**
 * AIBlock — the trust-UX primitive. Every AI output in the product renders
 * through this so the same guarantees always show:
 *   - "AI-generated — verify before acting" label
 *   - confidence indicator (low-confidence answers are visibly flagged)
 *   - inline citations to the grounding (SOP §, log line, ticket)
 *   - human-in-the-loop edit affordance
 *
 * Design-review decision (cross-phase theme: trust & grounding).
 */

interface Props<T> {
  title: string;
  result?: GroundedResult<T>;
  streaming?: boolean;
  /** Live token text while streaming, before the structured result lands. */
  streamText?: string;
  children?: (data: T) => ReactNode;
  onEdit?: () => void;
}

export function AIBlock<T>({ title, result, streaming, streamText, children, onEdit }: Props<T>) {
  const [showSources, setShowSources] = useState(false);
  const low = result ? result.confidence < CONFIDENCE_FLOOR : false;

  return (
    <motion.section className="ai-block" aria-busy={streaming} variants={fade} initial="hidden" animate="show">
      <header className="ai-block__head">
        <h3>{title}</h3>
        <span className="ai-block__badge"><Sparkle size={11} /> AI-generated — verify before acting</span>
      </header>

      {/* Streaming: ARIA live region so screen readers announce tokens. */}
      {streaming && (
        <div className="ai-block__stream" aria-live="polite">
          {streamText || "Thinking…"}
          <span className="ai-block__cursor">▌</span>
        </div>
      )}

      {result && !streaming && (
        <>
          {result.citations.length === 0 ? (
            <p className="ai-block__nosource" role="status">
              <AlertTriangle size={14} /> No supporting source found — this answer is ungrounded. Treat with caution.
            </p>
          ) : null}

          <div className="ai-block__body">{children?.(result.data)}</div>

          <footer className="ai-block__foot">
            <span className={`ai-block__conf ${low ? "is-low" : "is-ok"}`}>
              {low ? "Low confidence" : "Grounded"} · {(result.confidence * 100).toFixed(0)}%
            </span>
            <span className="ai-block__model">{result.model}</span>
            {result.redacted && (
              <span className="ai-block__redacted" title="PII/secrets scrubbed before the model saw this">
                <Lock size={11} /> redacted
              </span>
            )}
            {result.citations.length > 0 && (
              <button className="link" onClick={() => setShowSources((s) => !s)}>
                {showSources ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                {showSources ? "Hide" : "Show"} {result.citations.length} source
                {result.citations.length > 1 ? "s" : ""}
              </button>
            )}
            {onEdit && (
              <button className="link" onClick={onEdit}>
                <Pencil size={12} /> Edit before use
              </button>
            )}
          </footer>

          {showSources && (
            <ul className="ai-block__sources">
              {result.citations.map((c, i) => (
                <li key={i}>
                  <strong>[{c.kind}]</strong> {c.label}
                  <blockquote>{c.snippet}</blockquote>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </motion.section>
  );
}
