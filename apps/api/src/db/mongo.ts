import mongoose from "mongoose";
import { config } from "../config.js";

/**
 * Lazy, non-blocking Mongo connector.
 *
 * The API must boot WITHOUT MongoDB so health + job endpoints (Redis-only) work
 * even when the DB is down. Mongo is connected on first use by the routes that
 * need it (tickets, SOP search, RCA retrieval). If it's unavailable those routes
 * return a clean 503 `db_unavailable`; everything else keeps working.
 */

export type MongoState = "disconnected" | "connecting" | "connected";

let state: MongoState = "disconnected";
let connectPromise: Promise<typeof mongoose> | null = null;

mongoose.set("strictQuery", true);
// Fail fast instead of buffering queries for 10s when disconnected — lets the
// requireMongo guard return a 503 quickly rather than hanging the request.
mongoose.set("bufferCommands", false);

mongoose.connection.on("connected", () => {
  state = "connected";
});
mongoose.connection.on("disconnected", () => {
  state = "disconnected";
  connectPromise = null;
});

/** Thrown when a Mongo-dependent operation runs while the DB is unreachable. */
export class DbUnavailableError extends Error {
  constructor() {
    super("db_unavailable");
    this.name = "DbUnavailableError";
  }
}

/** Lazy-connect for code paths (e.g. the worker) not behind the requireMongo guard. */
export async function ensureMongo(): Promise<void> {
  try {
    await connectMongo();
  } catch {
    throw new DbUnavailableError();
  }
}

export function mongoState(): MongoState {
  return state;
}

export function isMongoConnected(): boolean {
  return state === "connected";
}

/**
 * Connect (idempotent). Concurrent callers share one in-flight promise. Rejects
 * if the server can't be reached within the selection timeout; callers decide
 * whether that's fatal (it isn't, for the API).
 */
export async function connectMongo(): Promise<typeof mongoose> {
  if (state === "connected") return mongoose;
  if (connectPromise) return connectPromise;

  state = "connecting";
  connectPromise = mongoose
    .connect(config.MONGODB_URI, { serverSelectionTimeoutMS: 3000 })
    .then((m) => {
      state = "connected";
      console.log(`[mongo] connected: ${config.MONGODB_URI.replace(/\/\/[^@]*@/, "//***@")}`);
      return m;
    })
    .catch((err) => {
      state = "disconnected";
      connectPromise = null;
      throw err;
    });

  return connectPromise;
}

/** Best-effort warm connect at boot. Never throws — logs and moves on. */
export function warmConnectMongo(context: string): void {
  connectMongo().catch(() => {
    console.warn(
      `[mongo] not reachable at ${context}. Health + jobs work; ticket/SOP features will 503 until Mongo is up.`,
    );
  });
}

export async function disconnectMongo(): Promise<void> {
  if (state === "disconnected") return;
  await mongoose.disconnect();
  state = "disconnected";
  connectPromise = null;
}
