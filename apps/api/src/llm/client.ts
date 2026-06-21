import OpenAI from "openai";
import { config } from "../config.js";

/**
 * Thin LLM client with a built-in mock mode.
 *
 * DX-review decision: `LLM_MODE=mock` lets a developer run the entire flow with
 * no API key and no spend (time-to-hello-world ≈ 15 min). The mock returns
 * deterministic, structurally-valid output so the UI and job pipeline can be
 * exercised end to end.
 */

export type ChatTier = "small" | "large";

export interface ChatRequest {
  tier: ChatTier;
  system: string;
  /** Untrusted content (ticket/log/SOP) — already redacted, fenced by caller. */
  user: string;
  /** Forces JSON output. */
  json?: boolean;
  onToken?: (t: string) => void;
}

export interface ChatResponse {
  text: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

const openai =
  config.LLM_MODE === "openai" ? new OpenAI({ apiKey: config.OPENAI_API_KEY }) : null;

function modelFor(tier: ChatTier): string {
  return tier === "large" ? config.OPENAI_CHAT_MODEL_LARGE : config.OPENAI_CHAT_MODEL_SMALL;
}

export async function chat(req: ChatRequest): Promise<ChatResponse> {
  const model = modelFor(req.tier);

  if (!openai) {
    return mockChat(req, model);
  }

  const stream = await openai.chat.completions.create({
    model,
    stream: true,
    response_format: req.json ? { type: "json_object" } : undefined,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
  });

  let text = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (delta) {
      text += delta;
      req.onToken?.(delta);
    }
  }

  // Token accounting is approximate without a usage chunk; good enough for the
  // per-tenant budget meter. Replace with `stream_options: { include_usage }`.
  return {
    text,
    model,
    promptTokens: Math.ceil(req.user.length / 4),
    completionTokens: Math.ceil(text.length / 4),
  };
}

export async function embed(text: string): Promise<number[]> {
  if (!openai) return mockEmbed(text);
  const res = await openai.embeddings.create({
    model: config.OPENAI_EMBEDDING_MODEL,
    input: text,
  });
  return res.data[0]!.embedding;
}

// ── Mock implementations ────────────────────────────────────────────────────

async function mockChat(req: ChatRequest, model: string): Promise<ChatResponse> {
  const text = req.json
    ? JSON.stringify(mockJsonFor(req.system))
    : `[mock-llm] Grounded answer derived only from the provided context. ` +
      `Replace LLM_MODE=mock with =openai for live output.`;

  // Simulate token streaming so the SSE path is exercised in dev.
  if (req.onToken) {
    for (const word of text.split(" ")) {
      req.onToken(word + " ");
      await sleep(8);
    }
  }
  return { text, model: `${model} (mock)`, promptTokens: 50, completionTokens: 60 };
}

function mockJsonFor(system: string): unknown {
  if (system.includes("RCA")) {
    return {
      title: "[mock] RCA: elevated 5xx after deploy",
      rootCause: "Connection pool exhausted under retry storm (grounded in attached logs).",
      contributingFactors: ["No circuit breaker", "Aggressive client retries"],
      timeline: ["t0 deploy", "t+4m 5xx climbs", "t+11m pool saturated"],
      remediation: ["Add circuit breaker", "Cap retries", "Raise pool ceiling per runbook §4"],
    };
  }
  if (system.includes("summariz")) {
    return {
      headline: "[mock] DB failover caused 12m partial outage",
      summary: "Checkout latency spiked; reads degraded during failover.",
      impact: "~8% of checkout requests slow for 12 minutes.",
      nextActions: ["Confirm replica health", "Notify #status"],
    };
  }
  return { answer: "[mock] See runbook §4 for the failover procedure." };
}

function mockEmbed(text: string): number[] {
  // Deterministic pseudo-embedding so local vector search returns stable order.
  const dim = 1536;
  const v = new Array(dim).fill(0);
  for (let i = 0; i < text.length; i++) v[i % dim] += text.charCodeAt(i) % 13;
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
