import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BellOff, CheckCircle2 } from "lucide-react";
import type { Alert } from "@ops-copilot/shared";
import { listAlerts, resolveAlert, streamAlerts, ApiCallError } from "../api/client.js";
import { AlertSeverityBadge, timeAgo } from "../components/badges.js";
import { ErrorNote } from "../components/ui/ErrorNote.js";
import { EmptyState } from "../components/ui/EmptyState.js";
import { ListRowSkeleton } from "../components/ui/Skeleton.js";
import { arriveTop } from "../components/ui/motion.js";

type Filter = "all" | "firing" | "resolved";

/**
 * Real-time alerts. Loads the recent feed, then keeps it live over SSE: new
 * alerts arrive at the top and resolutions flip status in place. The "LIVE"
 * pulse reflects an open stream.
 */
export function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string>();
  const [live, setLive] = useState(false);
  const [resolving, setResolving] = useState<string>();

  // Merge an alert into state by id (new → prepend, existing → replace).
  const upsert = (a: Alert) =>
    setAlerts((cur) => {
      const rest = cur.filter((x) => x.id !== a.id);
      return [a, ...rest].sort((x, y) => (x.at < y.at ? 1 : -1));
    });
  const upsertRef = useRef(upsert);
  upsertRef.current = upsert;

  useEffect(() => {
    let unsub = () => {};
    let cancelled = false;
    listAlerts({})
      .then((a) => !cancelled && setAlerts(a))
      .catch((e) => !cancelled && setError(e instanceof ApiCallError ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));

    streamAlerts({
      onAlert: (a) => upsertRef.current(a),
      onResolved: (a) => upsertRef.current(a),
      onError: () => setLive(false),
    }).then((fn) => {
      if (cancelled) fn();
      else {
        unsub = fn;
        setLive(true);
      }
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  async function onResolve(id: string) {
    setResolving(id);
    try {
      const a = await resolveAlert(id);
      upsert(a);
    } catch (e) {
      setError(e instanceof ApiCallError ? e.message : String(e));
    } finally {
      setResolving(undefined);
    }
  }

  const shown = alerts.filter((a) => filter === "all" || a.status === filter);

  return (
    <div className="page">
      <div className="page__head">
        <h2>
          Alerts <span className={`live ${live ? "is-live" : ""}`} title={live ? "Live stream connected" : "Stream offline"}>{live ? "LIVE" : "offline"}</span>
        </h2>
        <div className="filter-group" role="group" aria-label="Filter alerts">
          {(["all", "firing", "resolved"] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? "chip active" : "chip"} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {loading ? (
        <div className="skeleton-stack">
          {Array.from({ length: 4 }).map((_, i) => <ListRowSkeleton key={i} />)}
        </div>
      ) : (
        <ul className="alert-list" aria-live="polite">
          <AnimatePresence initial={false}>
            {shown.map((a) => (
              <motion.li
                key={a.id}
                layout
                variants={arriveTop}
                initial="hidden"
                animate="show"
                exit="exit"
                className={`alert-row alert-row--${a.severity} ${a.status === "resolved" ? "is-resolved" : ""}`}
              >
                <AlertSeverityBadge severity={a.severity} />
                <div className="alert-row__main">
                  <strong>{a.title}</strong>
                  <span className="muted small">
                    {a.service} · {a.source}
                    {a.value ? ` · ${a.value}` : ""}
                  </span>
                </div>
                <span className="muted small">{timeAgo(a.at)}</span>
                {a.status === "firing" ? (
                  <button className="btn-sm" disabled={resolving === a.id} onClick={() => onResolve(a.id)}>
                    {resolving === a.id ? "…" : "Resolve"}
                  </button>
                ) : (
                  <span className="badge st st--resolved"><CheckCircle2 size={11} /> resolved</span>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      {!loading && shown.length === 0 && (
        <EmptyState icon={<BellOff size={20} />} title="No alerts in this view" description="Switch filters, or wait for the live feed." />
      )}
    </div>
  );
}
