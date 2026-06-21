import mongoose, { Schema, type InferSchemaType } from "mongoose";

/**
 * Multi-tenant from day 1 (Eng-review decision). EVERY document carries
 * `tenantId`, and every query in the app must scope by it. Retrofitting tenancy
 * later is brutal, so it's baked into the schemas here.
 */

const tenantScoped = { tenantId: { type: String, required: true, index: true } };

// ── Users ────────────────────────────────────────────────────────────────────
const userSchema = new Schema(
  {
    ...tenantScoped,
    email: { type: String, required: true },
    role: { type: String, enum: ["engineer", "admin"], default: "engineer" },
  },
  { timestamps: true },
);
userSchema.index({ tenantId: 1, email: 1 }, { unique: true });

// ── Tickets ──────────────────────────────────────────────────────────────────
const ticketSchema = new Schema(
  {
    ...tenantScoped,
    externalId: String,
    title: String,
    body: { type: String, required: true },
    status: { type: String, default: "open" },
  },
  { timestamps: true },
);

// ── Incidents ────────────────────────────────────────────────────────────────
const incidentSchema = new Schema(
  {
    ...tenantScoped,
    title: { type: String, required: true },
    summary: String,
    logSnippet: String,
    ticketId: { type: Schema.Types.ObjectId, ref: "Ticket" },
  },
  { timestamps: true },
);

// ── SOPs (runbooks) — the grounding source ───────────────────────────────────
// `embedding` is indexed by MongoDB Atlas Vector Search in production. The
// `embeddingVersion` lets us invalidate stale vectors when a runbook changes.
const sopSchema = new Schema(
  {
    ...tenantScoped,
    title: { type: String, required: true },
    section: String,
    text: { type: String, required: true },
    embedding: { type: [Number], default: [] },
    embeddingVersion: { type: Number, default: 1 },
  },
  { timestamps: true },
);

// ── RCA documents (persisted, human-editable) ────────────────────────────────
// `incidentId` is a free-form string (an incident may not be a stored entity in
// mock mode). One current RCA per incidentId when provided (upserted).
const rcaSchema = new Schema(
  {
    ...tenantScoped,
    incidentId: { type: String, index: true },
    jobId: String,
    title: { type: String, required: true },
    rootCause: { type: String, required: true },
    contributingFactors: { type: [String], default: [] },
    timeline: { type: [String], default: [] },
    remediation: { type: [String], default: [] },
    confidence: Number,
    citations: { type: [Schema.Types.Mixed], default: [] },
    model: String,
    editedByHuman: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// ── Ticket summaries (persisted, human-editable) ─────────────────────────────
// One current summary per ticket (upserted). `editedByHuman` records whether a
// human revised the AI draft before saving — the trust audit trail.
const summarySchema = new Schema(
  {
    ...tenantScoped,
    ticketId: { type: Schema.Types.ObjectId, ref: "Ticket", required: true },
    jobId: String,
    headline: { type: String, required: true },
    summary: { type: String, required: true },
    impact: String,
    nextActions: { type: [String], default: [] },
    confidence: Number,
    citations: { type: [Schema.Types.Mixed], default: [] },
    model: String,
    editedByHuman: { type: Boolean, default: false },
  },
  { timestamps: true },
);
summarySchema.index({ tenantId: 1, ticketId: 1 }, { unique: true });

// ── Redaction audit log — proves PII never left unredacted ────────────────────
const redactionAuditSchema = new Schema(
  {
    ...tenantScoped,
    jobId: String,
    hits: Schema.Types.Mixed,
    at: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

export const User = mongoose.model("User", userSchema);
export const Ticket = mongoose.model("Ticket", ticketSchema);
export const Incident = mongoose.model("Incident", incidentSchema);
export const Sop = mongoose.model("Sop", sopSchema);
export const Rca = mongoose.model("Rca", rcaSchema);
export const Summary = mongoose.model("Summary", summarySchema);
export const RedactionAudit = mongoose.model("RedactionAudit", redactionAuditSchema);

export type SopDoc = InferSchemaType<typeof sopSchema> & { _id: mongoose.Types.ObjectId };
