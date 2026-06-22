import { listQueues } from "../api/client.js";
import { useAsync } from "../hooks/useAsync.js";
import { QueueStatusBadge } from "../components/badges.js";

/** Work-queue monitoring: depth, in-flight, throughput, oldest item age. */
export function QueuesPage() {
  const { data, error, loading, reload } = useAsync(() => listQueues(), []);

  const fmtAge = (s: number) => (s < 60 ? `${s}s` : `${Math.round(s / 60)}m`);

  return (
    <div className="page">
      <div className="page__head">
        <h2>Queue monitoring</h2>
        <button className="btn-ghost" onClick={reload}>↻ Refresh</button>
      </div>

      {error && <div className="error-note" role="alert">{error}</div>}
      {loading && !data && <p className="muted">Loading…</p>}

      {data && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Queue</th><th>Status</th><th className="num">Depth</th><th className="num">In-flight</th>
                <th className="num">Rate/min</th><th className="num">Oldest</th><th className="num">Consumers</th>
              </tr>
            </thead>
            <tbody>
              {data.map((q) => (
                <tr key={q.id} className={`q-row q-row--${q.status}`}>
                  <td>{q.name}</td>
                  <td><QueueStatusBadge status={q.status} /></td>
                  <td className="num">{q.depth.toLocaleString()}</td>
                  <td className="num">{q.inFlight}</td>
                  <td className="num">{q.ratePerMin}</td>
                  <td className="num">{fmtAge(q.oldestAgeSec)}</td>
                  <td className="num">{q.consumers}</td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr><td colSpan={7} className="muted">No queues. Run <code>npm run seed</code>.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
