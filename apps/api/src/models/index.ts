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

// ── RCA documents ────────────────────────────────────────────────────────────
const rcaSchema = new Schema(
  {
    ...tenantScoped,
    incidentId: { type: Schema.Types.ObjectId, ref: "Incident" },
    document: Schema.Types.Mixed,
    citations: { type: [Schema.Types.Mixed], default: [] },
    confidence: Number,
    editedByHuman: { type: Boolean, default: false },
  },
  { timestamps: true },
);

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
export const RedactionAudit = mongoose.model("RedactionAudit", redactionAuditSchema);

export type SopDoc = InferSchemaType<typeof sopSchema> & { _id: mongoose.Types.ObjectId };
