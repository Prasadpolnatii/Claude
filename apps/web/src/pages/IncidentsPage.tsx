import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, CheckCheck, Download, Inbox, RefreshCw, Send } from "lucide-react";
import type { IncidentDetail, IncidentSeverity, IncidentStatus, UserRole } from "@ops-copilot/shared";
import { INCIDENT_SEVERITIES, INCIDENT_STATUSES } from "@ops-copilot/shared";
import {
  ackIncident,
  addIncidentNote,
  getIncident,
  getIncidentReport,
  listIncidents,
  resolveIncident,
  type IncidentReport,
  ApiCallError,
} from "../api/client.js";
import { useAsync } from "../hooks/useAsync.js";
import { IncidentStatusBadge, SeverityBadge, timeAgo } from "../components/badges.js";
import { IncidentReportPrint } from "../components/IncidentReportPrint.js";
import { ErrorNote } from "../components/ui/ErrorNote.js";
import { EmptyState } from "../components/ui/EmptyState.js";
import { ListRowSkeleton } from "../components/ui/Skeleton.js";
import { fade, listItem } from "../components/ui/motion.js";

/**
 * Incident list with severity/status filters and a detail panel: full timeline,
 * acknowledge / resolve / add-note actions, and "Export to PDF".
 */
export function IncidentsPage({ role }: { role: UserRole }) {
  const [sev, setSev] = useState<Set<IncidentSeverity>>(new Set());
  const [status, setStatus] = useState<Set<IncidentStatus>>(new Set());
  const sevArr = [...sev];
  const statusArr = [...status];

  const { data, error, loading, reload } = useAsync(
    () => listIncidents({ severity: sevArr, status: statusArr }),
    [sevArr.join(","), statusArr.join(",")],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [report, setReport] = useState<IncidentReport | null>(null);

  // Default the selection to the top of the list when it (re)loads.
  useEffect(() => {
    if (!data) return;
    setSelectedId((cur) => (cur && data.some((i) => i.id === cur) ? cur : data[0]?.id ?? null));
  }, [data]);

  const toggle = <T,>(set: Set<T>, setter: (s: Set<T>) => void, v: T) => {
    const next = new Set(set);
    next.has(v) ? next.delete(v) : next.add(v);
    setter(next);
  };

  return (
    <div className="page">
      {report && <IncidentReportPrint report={report} onDone={() => setReport(null)} />}

      <div className="page__head">
        <h2>Incidents</h2>
        <button className="btn-ghost" onClick={reload}><RefreshCw size={14} /> Refresh</button>
      </div>

      <div className="filters">
        <div className="filter-group" role="group" aria-label="Filter by severity">
          {INCIDENT_SEVERITIES.map((s) => (
            <button key={s} className={sev.has(s) ? "chip active" : "chip"} aria-pressed={sev.has(s)} onClick={() => toggle(sev, setSev, s)}>
              {s.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="filter-group" role="group" aria-label="Filter by status">
          {INCIDENT_STATUSES.map((s) => (
            <button key={s} className={status.has(s) ? "chip active" : "chip"} aria-pressed={status.has(s)} onClick={() => toggle(status, setStatus, s)}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="split">
        <aside className="list-pane">
          {loading && !data && (
            <div className="skeleton-stack">
              {Array.from({ length: 5 }).map((_, i) => <ListRowSkeleton key={i} />)}
            </div>
          )}
          <ul className="incident-list">
            <AnimatePresence initial={false}>
              {data?.map((i) => (
                <motion.li key={i.id} layout variants={listItem} initial="hidden" animate="show" exit="exit">
                  <button className={selectedId === i.id ? "active" : ""} onClick={() => setSelectedId(i.id)}>
                    <div className="incident-list__top">
                      <SeverityBadge severity={i.severity} />
                      <IncidentStatusBadge status={i.status} />
                    </div>
                    <strong>{i.title}</strong>
                    <span className="muted small">{i.service} · {timeAgo(i.startedAt)}</span>
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          {data && data.length === 0 && (
            <EmptyState icon={<Inbox size={20} />} title="No incidents match" description="Try clearing a filter to widen the results." />
          )}
        </aside>

        <div className="detail-pane">
          <AnimatePresence mode="wait">
            {selectedId ? (
              <motion.div key={selectedId} variants={fade} initial="hidden" animate="show" exit="exit">
                <IncidentDetailView
                  id={selectedId}
                  role={role}
                  onChanged={reload}
                  onExport={async (id) => setReport(await getIncidentReport(id))}
                />
              </motion.div>
            ) : (
              <EmptyState icon={<Inbox size={20} />} title="Select an incident" description="Pick one from the list to see its timeline." />
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function IncidentDetailView({
  id,
  role,
  onChanged,
  onExport,
}: {
  id: string;
  role: UserRole;
  onChanged: () => void;
  onExport: (id: string) => Promise<void>;
}) {
  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let alive = true;
    getIncident(id)
      .then((d) => alive && setIncident(d))
      .catch((e) => alive && setError(e instanceof ApiCallError ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [id]);

  async function act(fn: () => Promise<IncidentDetail>) {
    setBusy(true);
    setError(undefined);
    try {
      const updated = await fn();
      setIncident(updated);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiCallError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!incident) return <ListRowSkeleton />;

  const canEdit = role === "engineer" || role === "admin"; // both operate incidents
  const isResolved = incident.status === "resolved";

  return (
    <div className="incident-detail">
      <div className="incident-detail__head">
        <SeverityBadge severity={incident.severity} />
        <IncidentStatusBadge status={incident.status} />
        <h3>{incident.title}</h3>
      </div>
      <p className="muted small">
        {incident.service} · started {timeAgo(incident.startedAt)}
        {incident.acknowledgedBy ? ` · ack by ${incident.acknowledgedBy}` : ""}
      </p>

      {incident.summary && <p>{incident.summary}</p>}
      {incident.logSnippet && <pre className="log">{incident.logSnippet}</pre>}

      <div className="incident-detail__actions">
        {canEdit && incident.status === "open" && (
          <button className="btn" disabled={busy} onClick={() => act(() => ackIncident(id))}><Check size={14} /> Acknowledge</button>
        )}
        {canEdit && !isResolved && (
          <button className="btn" disabled={busy} onClick={() => act(() => resolveIncident(id))}><CheckCheck size={14} /> Resolve</button>
        )}
        <button
          className="btn-ghost"
          disabled={exporting}
          onClick={async () => {
            setExporting(true);
            try {
              await onExport(id);
            } catch (e) {
              setError(e instanceof ApiCallError ? e.message : String(e));
            } finally {
              setExporting(false);
            }
          }}
        >
          <Download size={14} /> {exporting ? "Preparing…" : "Export PDF"}
        </button>
      </div>

      <h4>Timeline</h4>
      <ol className="timeline">
        {incident.timeline.map((e, i) => (
          <li key={i} className={`timeline__item timeline__item--${e.kind}`}>
            <span className="timeline__time" title={new Date(e.at).toLocaleString()}>{timeAgo(e.at)}</span>
            <span className="timeline__msg">
              {e.message}
              {e.actor ? <span className="muted small"> · {e.actor}</span> : null}
            </span>
          </li>
        ))}
      </ol>

      {canEdit && !isResolved && (
        <form
          className="note-form"
          onSubmit={(e) => {
            e.preventDefault();
            const m = note.trim();
            if (!m) return;
            act(() => addIncidentNote(id, m)).then(() => setNote(""));
          }}
        >
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a timeline note…" aria-label="Add note" />
          <button className="btn" disabled={busy || !note.trim()}><Send size={14} /> Add note</button>
        </form>
      )}
    </div>
  );
}
