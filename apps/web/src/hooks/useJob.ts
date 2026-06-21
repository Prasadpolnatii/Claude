import { useCallback, useRef, useState } from "react";
import type { GroundedResult, JobType } from "@ops-copilot/shared";
import { ApiCallError, streamJob, submitJob } from "../api/client.js";

/**
 * useJob — submit a generative job and consume its SSE stream.
 * Encapsulates the async contract so pages just call `run(input)` and read
 * `{ streaming, streamText, result, error }`.
 */
export function useJob<T>(type: JobType) {
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [result, setResult] = useState<GroundedResult<T>>();
  const [error, setError] = useState<{ code: string; message: string; retryable: boolean }>();
  const unsub = useRef<() => void>();

  const run = useCallback(
    async (input: Record<string, unknown>) => {
      setError(undefined);
      setResult(undefined);
      setStreamText("");
      setStreaming(true);
      try {
        // Idempotency key prevents a double-submit from burning two LLM calls.
        const idem = crypto.randomUUID();
        const { jobId } = await submitJob(type, input, idem);
        unsub.current = streamJob(jobId, {
          onToken: (t) => setStreamText((prev) => prev + t),
          onDone: (job) => {
            setStreaming(false);
            if (job.status === "succeeded") setResult(job.result as GroundedResult<T>);
            else setError(job.error ?? { code: "internal", message: "Job failed.", retryable: true });
          },
          onError: (code, message) => {
            setStreaming(false);
            setError({ code, message, retryable: code === "llm_unavailable" });
          },
        });
      } catch (e) {
        setStreaming(false);
        if (e instanceof ApiCallError) setError({ code: e.code, message: e.message, retryable: e.retryable });
        else setError({ code: "internal", message: String(e), retryable: true });
      }
    },
    [type],
  );

  return { run, streaming, streamText, result, error };
}
