import { z } from "zod";

/**
 * Validation for the human-editable ticket summary save payload.
 *
 * Kept in its own dependency-free module so it can be unit-tested without
 * importing Mongo/Redis/Express. Bounds are generous but finite — they stop a
 * malformed or oversized save from reaching the DB.
 */
export const ticketSummaryInputSchema = z.object({
  headline: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(4000),
  impact: z.string().max(2000).default(""),
  nextActions: z.array(z.string().max(500)).max(20).default([]),
  /** Set by the client when a human revised the AI draft before saving. */
  editedByHuman: z.boolean().default(false),
  /** Optional link back to the job that produced the draft. */
  jobId: z.string().max(200).optional(),
});

export type TicketSummaryInput = z.infer<typeof ticketSummaryInputSchema>;
