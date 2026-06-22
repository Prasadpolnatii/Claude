import { useCallback, useEffect, useRef, useState } from "react";
import { ApiCallError } from "../api/client.js";

/**
 * Tiny data-fetch hook for read endpoints: runs `fn` on mount and whenever
 * `deps` change, exposing { data, error, loading, reload }. Guards against
 * setting state after unmount. Errors are normalized to a string message.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = useCallback(() => {
    setLoading(true);
    setError(undefined);
    fnRef
      .current()
      .then((d) => alive.current && setData(d))
      .catch((e) => alive.current && setError(e instanceof ApiCallError ? e.message : String(e)))
      .finally(() => alive.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    run();
  }, [run]);

  return { data, error, loading, reload: run, setData };
}
