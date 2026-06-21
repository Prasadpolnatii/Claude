import IORedis from "ioredis";
import { config } from "../config.js";

/**
 * Dedicated Redis client for the mock SOP store (used when Mongo is down).
 *
 * `lazyConnect: true` so merely importing this module — e.g. transitively in a
 * unit test — does NOT open a socket. The connection is established on the first
 * command. This is intentionally separate from the BullMQ connection, whose
 * QueueEvents consumer connects eagerly.
 */
export const mockStore = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
});
