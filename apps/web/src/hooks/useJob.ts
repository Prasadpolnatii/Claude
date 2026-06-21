import { useCallback, useRef, useState } from "react";
import type { GroundedResult, JobType } from "@ops-copilot/shared";
import { ApiCallError, streamJob, submitJob } from "../api/client.js";

interface JobState<T> {
  streaming: boolean;
  streamText: string;
  result?: GroundedResult<T>;
  error?: { code: string; message: string; retryable: boolean };
}

/**
 * useJobStream — submit a generative job via ANY submitter and consume its SSE
 * stream. The submitter returns `{ jobId }`; this hook handles streaming, the
 * grounded result, and errors. Pages provide the submitter so the same hook
 * works for /api/jobs and for POST /api/tickets/:id/summarize.
 */
export function useJobStream<T>() {
  const [state, setState] = useState<JobState<T>>({ streaming: false, streamText: "" });
  const unsub = useRef<() => void>();

  const run = useCallback(async (submit: () => Promise<{ jobId: string }>) => {
    unsub.current?.();
    setState({ streaming: true, streamText: "", result: undefined, error: undefined });
    try {
      const { jobId } = await submit();
      unsub.current = await streamJob(jobId, {
        onToken: (t) => setState((s) => ({ ...s, streamText: s.streamText + t })),
        onDone: (job) => {
          if (job.status === "succeeded") {
            setState((s) => ({ ...s, streaming: false, result: job.result as GroundedResult<T> }));
          } else {
            setState((s) => ({ ...s, streaming: false, error: job.error ?? { code: "internal", message: "Job failed.", retryable: true } }));
          }
        },
        onError: (code, message) =>
          setState((s) => ({ ...s, streaming: false, error: { code, message, retryable: code === "llm_unavailable" } })),
      });
    } catch (e) {
      const err = e instanceof ApiCallError ? { code: e.code, message: e.message, retryable: e.retryable } : { code: "internal", message: String(e), retryable: true };
      setState((s) => ({ ...s, streaming: false, error: err }));
    }
  }, []);

  const reset = useCallback(() => {
    unsub.current?.();
    setState({ streaming: false, streamText: "" });
  }, []);

  return { ...state, run, reset };
}

/** Convenience wrapper for the raw /api/jobs path (used by SOP search). */
export function useJob<T>(type: JobType) {
  const job = useJobStream<T>();
  const run = useCallback(
    (input: Record<string, unknown>) => job.run(() => submitJob(type, input, crypto.randomUUID())),
    [job, type],
  );
  return { ...job, run };
}
