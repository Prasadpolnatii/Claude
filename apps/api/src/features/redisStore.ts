import IORedis from "ioredis";
import { config } from "../config.js";

/**
 * Shared application Redis client (separate from the BullMQ connection).
 *
 * `lazyConnect: true` so merely importing this module — e.g. transitively in a
 * unit test — does NOT open a socket; the connection is established on the first
 * command. Used by the mock SOP store and the per-tenant token-budget meter.
 * Kept distinct from BullMQ's connection, whose QueueEvents consumer connects
 * eagerly.
 */
export const redis = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  // Fail a command after 3s instead of blocking forever when Redis is
  // unreachable. The client keeps reconnecting in the background (good for a
  // long-running server); callers (budget meter, mock store) catch + degrade.
  commandTimeout: 3000,
});
