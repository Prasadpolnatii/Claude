import { useEffect, useState } from "react";
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
        <button className="btn-ghost" onClick={reload}>↻ Refresh</button>
      </div>

      <div className="filters">
        <div className="filter-group" role="group" aria-label="Filter by severity">
          {INCIDENT_SEVERITIES.map((s) => (
            <button key={s} className={sev.has(s) ? "chip active" : "chip"} onClick={() => toggle(sev, setSev, s)}>
              {s.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="filter-group" role="group" aria-label="Filter by status">
          {INCIDENT_STATUSES.map((s) => (
            <button key={s} className={status.has(s) ? "chip active" : "chip"} onClick={() => toggle(status, setStatus, s)}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error-note" role="alert">{error}</div>}

      <div className="split">
        <aside className="list-pane">
          {loading && !data && <p className="muted">Loading…</p>}
          <ul className="incident-list">
            {data?.map((i) => (
              <li key={i.id}>
                <button className={selectedId === i.id ? "active" : ""} onClick={() => setSelectedId(i.id)}>
                  <div className="incident-list__top">
                    <SeverityBadge severity={i.severity} />
                    <IncidentStatusBadge status={i.status} />
                  </div>
                  <strong>{i.title}</strong>
                  <span className="muted small">{i.service} · {timeAgo(i.startedAt)}</span>
                </button>
              </li>
            ))}
            {data && data.length === 0 && <li className="muted">No incidents match the filters.</li>}
          </ul>
        </aside>

        <div className="detail-pane">
          {selectedId ? (
            <IncidentDetailView
              key={selectedId}
              id={selectedId}
              role={role}
              onChanged={reload}
              onExport={async (id) => setReport(await getIncidentReport(id))}
            />
          ) : (
            <p className="muted">Select an incident.</p>
          )}
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

  if (error) return <div className="error-note" role="alert">{error}</div>;
  if (!incident) return <p className="muted">Loading…</p>;

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
          <button className="btn" disabled={busy} onClick={() => act(() => ackIncident(id))}>Acknowledge</button>
        )}
        {canEdit && !isResolved && (
          <button className="btn" disabled={busy} onClick={() => act(() => resolveIncident(id))}>Resolve</button>
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
          {exporting ? "Preparing…" : "⭳ Export PDF"}
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
          <button className="btn" disabled={busy || !note.trim()}>Add note</button>
        </form>
      )}
    </div>
  );
}
