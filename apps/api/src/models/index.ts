import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";

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
// A single chronological event on an incident (detection, ack, note, resolve…).
// `_id: false` — these are embedded, not independently addressable.
const timelineEventSchema = new Schema(
  {
    at: { type: Date, default: Date.now },
    kind: {
      type: String,
      enum: ["detected", "note", "ack", "mitigated", "resolved", "status_change", "alert"],
      default: "note",
    },
    message: { type: String, required: true },
    actor: String,
  },
  { _id: false },
);

const incidentSchema = new Schema(
  {
    ...tenantScoped,
    title: { type: String, required: true },
    summary: String,
    logSnippet: String,
    service: { type: String, default: "unknown", index: true },
    severity: { type: String, enum: ["sev1", "sev2", "sev3", "sev4"], default: "sev3", index: true },
    status: {
      type: String,
      enum: ["open", "acknowledged", "mitigated", "resolved"],
      default: "open",
      index: true,
    },
    acknowledgedBy: String,
    startedAt: { type: Date, default: Date.now },
    resolvedAt: Date,
    timeline: { type: [timelineEventSchema], default: [] },
    ticketId: { type: Schema.Types.ObjectId, ref: "Ticket" },
  },
  { timestamps: true },
);
incidentSchema.index({ tenantId: 1, status: 1, severity: 1 });

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

// ── Application health ───────────────────────────────────────────────────────
// One row per monitored service; the dashboard renders each as a health card.
const applicationSchema = new Schema(
  {
    ...tenantScoped,
    name: { type: String, required: true },
    service: { type: String, required: true },
    status: { type: String, enum: ["healthy", "degraded", "down"], default: "healthy" },
    latencyMsP95: { type: Number, default: 0 },
    errorRatePct: { type: Number, default: 0 },
    uptimePct: { type: Number, default: 100 },
    requestsPerMin: { type: Number, default: 0 },
  },
  { timestamps: true },
);
applicationSchema.index({ tenantId: 1, name: 1 }, { unique: true });

// ── Alerts ───────────────────────────────────────────────────────────────────
const alertSchema = new Schema(
  {
    ...tenantScoped,
    severity: { type: String, enum: ["critical", "warning", "info"], default: "info", index: true },
    status: { type: String, enum: ["firing", "resolved"], default: "firing", index: true },
    title: { type: String, required: true },
    service: { type: String, default: "" },
    source: { type: String, default: "monitor" },
    value: String,
    firedAt: { type: Date, default: Date.now },
    resolvedAt: Date,
  },
  { timestamps: true },
);
alertSchema.index({ tenantId: 1, status: 1, firedAt: -1 });

// ── Queue stats — depth/throughput snapshots ─────────────────────────────────
const queueStatSchema = new Schema(
  {
    ...tenantScoped,
    name: { type: String, required: true },
    depth: { type: Number, default: 0 },
    inFlight: { type: Number, default: 0 },
    ratePerMin: { type: Number, default: 0 },
    oldestAgeSec: { type: Number, default: 0 },
    consumers: { type: Number, default: 1 },
  },
  { timestamps: true },
);
queueStatSchema.index({ tenantId: 1, name: 1 }, { unique: true });

// ── Knowledge base articles ──────────────────────────────────────────────────
const knowledgeSchema = new Schema(
  {
    ...tenantScoped,
    title: { type: String, required: true },
    category: { type: String, default: "general", index: true },
    tags: { type: [String], default: [] },
    body: { type: String, required: true },
  },
  { timestamps: true },
);

// ── Audit log — immutable record of who did what (admin-visible) ──────────────
const auditLogSchema = new Schema(
  {
    ...tenantScoped,
    actor: { type: String, required: true },
    role: { type: String, default: "" },
    action: { type: String, required: true },
    target: { type: String, default: "" },
    meta: Schema.Types.Mixed,
    at: { type: Date, default: Date.now },
  },
  { timestamps: false },
);
auditLogSchema.index({ tenantId: 1, at: -1 });

export const User = mongoose.model("User", userSchema);
export const Ticket = mongoose.model("Ticket", ticketSchema);
export const Incident = mongoose.model("Incident", incidentSchema);
export const Sop = mongoose.model("Sop", sopSchema);
export const Rca = mongoose.model("Rca", rcaSchema);
export const Summary = mongoose.model("Summary", summarySchema);
export const RedactionAudit = mongoose.model("RedactionAudit", redactionAuditSchema);
export const Application = mongoose.model("Application", applicationSchema);
export const Alert = mongoose.model("Alert", alertSchema);
export const QueueStat = mongoose.model("QueueStat", queueStatSchema);
export const Knowledge = mongoose.model("Knowledge", knowledgeSchema);
export const AuditLog = mongoose.model("AuditLog", auditLogSchema);

export type SopDoc = InferSchemaType<typeof sopSchema> & { _id: mongoose.Types.ObjectId };
export type IncidentDoc = HydratedDocument<InferSchemaType<typeof incidentSchema>>;
export type ApplicationDoc = HydratedDocument<InferSchemaType<typeof applicationSchema>>;
export type AlertDoc = HydratedDocument<InferSchemaType<typeof alertSchema>>;
export type QueueStatDoc = HydratedDocument<InferSchemaType<typeof queueStatSchema>>;
export type KnowledgeDoc = HydratedDocument<InferSchemaType<typeof knowledgeSchema>>;
export type AuditLogDoc = HydratedDocument<InferSchemaType<typeof auditLogSchema>>;
