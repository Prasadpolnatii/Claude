import { motion } from "framer-motion";
import { Layers, RefreshCw } from "lucide-react";
import { listQueues } from "../api/client.js";
import { useAsync } from "../hooks/useAsync.js";
import { QueueStatusBadge } from "../components/badges.js";
import { ErrorNote } from "../components/ui/ErrorNote.js";
import { EmptyState } from "../components/ui/EmptyState.js";
import { TableSkeleton } from "../components/ui/Skeleton.js";
import { EASE_OUT } from "../components/ui/motion.js";

/** Work-queue monitoring: depth, in-flight, throughput, oldest item age. */
export function QueuesPage() {
  const { data, error, loading, reload } = useAsync(() => listQueues(), []);

  const fmtAge = (s: number) => (s < 60 ? `${s}s` : `${Math.round(s / 60)}m`);
  const maxDepth = Math.max(1, ...(data?.map((q) => q.depth) ?? [1]));

  return (
    <div className="page">
      <div className="page__head">
        <h2>Queue monitoring</h2>
        <button className="btn-ghost" onClick={reload}><RefreshCw size={14} /> Refresh</button>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {loading && !data && (
        <div className="table-wrap"><TableSkeleton rows={5} cols={7} /></div>
      )}

      {data && data.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Queue</th><th>Status</th><th className="num">Depth</th><th className="num">In-flight</th>
                <th className="num">Rate/min</th><th className="num">Oldest</th><th className="num">Consumers</th>
              </tr>
            </thead>
            <tbody>
              {data.map((q, i) => (
                <motion.tr
                  key={q.id}
                  className={`q-row q-row--${q.status}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.24, delay: i * 0.02, ease: EASE_OUT }}
                >
                  <td>{q.name}</td>
                  <td><QueueStatusBadge status={q.status} /></td>
                  <td className="num">
                    <span className="depth-cell">
                      <span className="depth-cell__track">
                        <span className="depth-cell__fill" style={{ width: `${(q.depth / maxDepth) * 100}%` }} />
                      </span>
                      {q.depth.toLocaleString()}
                    </span>
                  </td>
                  <td className="num">{q.inFlight}</td>
                  <td className="num">{q.ratePerMin}</td>
                  <td className="num">{fmtAge(q.oldestAgeSec)}</td>
                  <td className="num">{q.consumers}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.length === 0 && (
        <EmptyState icon={<Layers size={20} />} title="No queues" description={<>Run <code>npm run seed</code> to populate demo data.</>} />
      )}
    </div>
  );
}
