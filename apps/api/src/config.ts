import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

// Workspace scripts run with cwd in apps/api, so a root .env wouldn't be found
// by dotenv's default ./.env. Walk up from this file to the first .env.
(function loadEnv() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return;
    }
    dir = dirname(dir);
  }
  dotenv.config(); // fall back to default lookup / real env vars
})();

/**
 * Fail-fast config. A missing JWT secret or Mongo URI should crash on boot,
 * not 500 on the first request.
 */
const schema = z.object({
  LLM_MODE: z.enum(["mock", "openai"]).default("mock"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_CHAT_MODEL_SMALL: z.string().default("gpt-4o-mini"),
  OPENAI_CHAT_MODEL_LARGE: z.string().default("gpt-4o"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),

  MONGODB_URI: z.string().default("mongodb://localhost:27017/ops_copilot"),
  VECTOR_INDEX_NAME: z.string().default("sop_vector_index"),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 chars"),
  JWT_ISSUER: z.string().default("ops-copilot"),

  API_PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),

  TENANT_DAILY_TOKEN_BUDGET: z.coerce.number().default(2_000_000),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("[config] invalid environment:\n", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;

if (config.LLM_MODE === "openai" && !config.OPENAI_API_KEY) {
  console.error("[config] LLM_MODE=openai requires OPENAI_API_KEY. Set it, or use LLM_MODE=mock.");
  process.exit(1);
}
