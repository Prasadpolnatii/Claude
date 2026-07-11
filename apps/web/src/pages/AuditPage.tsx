import { RefreshCw, ShieldAlert } from "lucide-react";
import { listAudit } from "../api/client.js";
import { useAsync } from "../hooks/useAsync.js";
import { timeAgo } from "../components/badges.js";
import { ErrorNote } from "../components/ui/ErrorNote.js";
import { EmptyState } from "../components/ui/EmptyState.js";
import { TableSkeleton } from "../components/ui/Skeleton.js";

/**
 * Audit log (admin only — the API also enforces this with requireRole). Shows
 * the immutable who-did-what trail for incident and knowledge mutations.
 */
export function AuditPage() {
  const { data, error, loading, reload } = useAsync(() => listAudit(), []);

  return (
    <div className="page">
      <div className="page__head">
        <h2>Audit log</h2>
        <button className="btn-ghost" onClick={reload}><RefreshCw size={14} /> Refresh</button>
      </div>

      {error && (
        <ErrorNote>
          {error}
          {error.toLowerCase().includes("role") && " — the audit log is restricted to admins."}
        </ErrorNote>
      )}

      {loading && !data && <div className="table-wrap"><TableSkeleton rows={6} cols={6} /></div>}

      {data && data.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>When</th><th>Actor</th><th>Role</th><th>Action</th><th>Target</th><th>Details</th></tr>
            </thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id}>
                  <td title={new Date(e.at).toLocaleString()}>{timeAgo(e.at)}</td>
                  <td>{e.actor}</td>
                  <td>{e.role}</td>
                  <td><code>{e.action}</code></td>
                  <td className="mono small">{e.target}</td>
                  <td className="muted small">{e.meta ? JSON.stringify(e.meta) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.length === 0 && (
        <EmptyState icon={<ShieldAlert size={20} />} title="No audit entries yet" description="Actions taken across the dashboard will appear here." />
      )}
    </div>
  );
}
