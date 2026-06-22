import { listApplications } from "../api/client.js";
import { useAsync } from "../hooks/useAsync.js";
import { HealthDot, timeAgo } from "../components/badges.js";

/** Application health cards — one per monitored service. */
export function HealthPage() {
  const { data, error, loading, reload } = useAsync(() => listApplications(), []);

  return (
    <div className="page">
      <div className="page__head">
        <h2>Application health</h2>
        <button className="btn-ghost" onClick={reload}>↻ Refresh</button>
      </div>

      {error && <div className="error-note" role="alert">{error}</div>}
      {loading && !data && <p className="muted">Loading…</p>}

      <div className="cards">
        {data?.map((app) => (
          <div key={app.id} className={`health-card health-card--${app.status}`}>
            <div className="health-card__head">
              <HealthDot status={app.status} />
              <strong>{app.name}</strong>
              <span className="muted small">{app.service}</span>
            </div>
            <dl className="metrics">
              <div><dt>p95 latency</dt><dd>{app.latencyMsP95} ms</dd></div>
              <div><dt>error rate</dt><dd>{app.errorRatePct}%</dd></div>
              <div><dt>uptime</dt><dd>{app.uptimePct}%</dd></div>
              <div><dt>req/min</dt><dd>{app.requestsPerMin.toLocaleString()}</dd></div>
            </dl>
            <span className="muted small">updated {timeAgo(app.updatedAt)}</span>
          </div>
        ))}
        {data && data.length === 0 && <p className="muted">No applications registered. Run <code>npm run seed</code>.</p>}
      </div>
    </div>
  );
}
