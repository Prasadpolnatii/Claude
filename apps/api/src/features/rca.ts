import { z } from "zod";

/**
 * Validation for RCA endpoints. Dependency-free so it can be unit-tested without
 * Mongo/Redis/Express.
 */

/** Generate request: what we feed the orchestrator. logSnippet is optional. */
export const rcaGenerateSchema = z.object({
  incidentSummary: z.string().trim().min(1).max(8000),
  logSnippet: z.string().max(20000).default(""),
  incidentId: z.string().max(200).optional(),
});

/** Save request: the reviewed (possibly human-edited) RCA document. */
export const rcaSaveInputSchema = z.object({
  incidentId: z.string().max(200).optional(),
  jobId: z.string().max(200).optional(),
  title: z.string().trim().min(1).max(300),
  rootCause: z.string().trim().min(1).max(8000),
  contributingFactors: z.array(z.string().max(1000)).max(50).default([]),
  timeline: z.array(z.string().max(1000)).max(100).default([]),
  remediation: z.array(z.string().max(1000)).max(50).default([]),
  confidence: z.number().min(0).max(1).optional(),
  citations: z.array(z.unknown()).max(50).default([]),
  /** True when a human revised the AI draft before saving. */
  editedByHuman: z.boolean().default(false),
});

export type RcaGenerateInput = z.infer<typeof rcaGenerateSchema>;
export type RcaSaveInput = z.infer<typeof rcaSaveInputSchema>;
