/**
 * Redaction proxy — runs before EVERY OpenAI call.
 *
 * Eng-review decision (High severity): tickets and logs leak PII and secrets
 * (emails, IPs, bearer tokens, AWS keys, private keys). Those must never reach
 * the LLM provider. This module is the single chokepoint.
 *
 * FAIL CLOSED: if redaction throws, the caller MUST abort the LLM call and
 * return `redaction_failed`. Never send unredacted text on error.
 */

export interface RedactionResult {
  text: string;
  /** Count of spans replaced, by category — written to the audit log. */
  hits: Record<string, number>;
}

interface Rule {
  category: string;
  pattern: RegExp;
}

// Order matters: most specific (private keys, tokens) before generic (email).
const RULES: Rule[] = [
  { category: "private_key", pattern: /-----BEGIN[^-]+PRIVATE KEY-----[\s\S]+?-----END[^-]+PRIVATE KEY-----/g },
  { category: "aws_access_key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { category: "bearer_token", pattern: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/g },
  { category: "jwt", pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g },
  { category: "openai_key", pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { category: "email", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { category: "ipv4", pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { category: "credit_card", pattern: /\b(?:\d[ -]*?){13,16}\b/g },
];

/**
 * Replace sensitive spans with stable placeholders like `[REDACTED:email#1]`.
 * Stable numbering lets the model still reason about "the same user" without
 * seeing the value.
 */
export function redact(input: string): RedactionResult {
  if (typeof input !== "string") {
    // Fail closed: a non-string slipping through is a programming error, but we
    // refuse rather than coerce-and-leak.
    throw new RedactionError("redaction received non-string input");
  }

  const hits: Record<string, number> = {};
  let text = input;

  for (const rule of RULES) {
    const seen = new Map<string, string>();
    text = text.replace(rule.pattern, (match) => {
      let token = seen.get(match);
      if (!token) {
        hits[rule.category] = (hits[rule.category] ?? 0) + 1;
        token = `[REDACTED:${rule.category}#${hits[rule.category]}]`;
        seen.set(match, token);
      }
      return token;
    });
  }

  return { text, hits };
}

export class RedactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedactionError";
  }
}

/**
 * Redact every string field passed to the LLM. Throws (fail closed) on any
 * failure so the orchestrator aborts the call.
 */
export function redactAll(parts: string[]): { texts: string[]; hits: Record<string, number> } {
  const merged: Record<string, number> = {};
  const texts = parts.map((p) => {
    const { text, hits } = redact(p);
    for (const [k, v] of Object.entries(hits)) merged[k] = (merged[k] ?? 0) + v;
    return text;
  });
  return { texts, hits: merged };
}
