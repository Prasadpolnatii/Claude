import { getOverview } from "../api/client.js";
import { useAsync } from "../hooks/useAsync.js";
import type { Tab } from "../nav.js";

/**
 * Landing page: roll-up counters across incidents, alerts, application health,
 * and queues. Each card deep-links to its section.
 */
export function OverviewPage({ onNavigate }: { onNavigate: (t: Tab) => void }) {
  const { data, error, loading, reload } = useAsync(() => getOverview(), []);

  return (
    <div className="page">
      <div className="page__head">
        <h2>Operations overview</h2>
        <button className="btn-ghost" onClick={reload}>↻ Refresh</button>
      </div>

      {error && <div className="error-note" role="alert">{error}</div>}
      {loading && !data && <p className="muted">Loading…</p>}

      {data && (
        <>
          <div className="cards">
            <button className="stat-card stat-card--btn" onClick={() => onNavigate("incidents")}>
              <span className="stat-card__label">Open incidents</span>
              <span className="stat-card__value">{data.incidents.open}</span>
              <span className="stat-card__sub">
                <span className="sev sev--sev1">{data.incidents.bySeverity.sev1} SEV1</span>{" "}
                <span className="sev sev--sev2">{data.incidents.bySeverity.sev2} SEV2</span>
              </span>
            </button>

            <button className="stat-card stat-card--btn" onClick={() => onNavigate("alerts")}>
              <span className="stat-card__label">Firing alerts</span>
              <span className="stat-card__value">{data.alerts.firing}</span>
              <span className="stat-card__sub">
                <span className="alev alev--critical">{data.alerts.bySeverity.critical} critical</span>{" "}
                <span className="alev alev--warning">{data.alerts.bySeverity.warning} warning</span>
              </span>
            </button>

            <button className="stat-card stat-card--btn" onClick={() => onNavigate("health")}>
              <span className="stat-card__label">Applications</span>
              <span className="stat-card__value">
                {data.applications.healthy}/{data.applications.total}
              </span>
              <span className="stat-card__sub">
                <span className="ok">healthy</span> · {data.applications.degraded} degraded · {data.applications.down} down
              </span>
            </button>

            <button className="stat-card stat-card--btn" onClick={() => onNavigate("queues")}>
              <span className="stat-card__label">Queues</span>
              <span className="stat-card__value">{data.queues.total}</span>
              <span className="stat-card__sub">
                {data.queues.critical} critical · {data.queues.warning} warning
              </span>
            </button>
          </div>
          <p className="muted small">Updated {new Date(data.updatedAt).toLocaleTimeString()}</p>
        </>
      )}
    </div>
  );
}
