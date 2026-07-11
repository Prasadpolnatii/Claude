import { motion } from "framer-motion";
import { RefreshCw, ServerOff } from "lucide-react";
import type { HealthStatus } from "@ops-copilot/shared";
import { listApplications } from "../api/client.js";
import { useAsync } from "../hooks/useAsync.js";
import { HealthDot, timeAgo } from "../components/badges.js";
import { ErrorNote } from "../components/ui/ErrorNote.js";
import { EmptyState } from "../components/ui/EmptyState.js";
import { CardSkeleton } from "../components/ui/Skeleton.js";
import { Meter, RingGauge } from "../components/ui/Meter.js";
import { fadeUp, staggerContainer } from "../components/ui/motion.js";

const ringTone = (status: HealthStatus) => (status === "healthy" ? "ok" : status === "degraded" ? "warn" : "danger");
const errorTone = (pct: number) => (pct < 1 ? "ok" : pct < 5 ? "warn" : "danger");

/** Application health cards — one per monitored service. */
export function HealthPage() {
  const { data, error, loading, reload } = useAsync(() => listApplications(), []);

  return (
    <div className="page">
      <div className="page__head">
        <h2>Application health</h2>
        <button className="btn-ghost" onClick={reload}><RefreshCw size={14} /> Refresh</button>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {loading && !data && (
        <div className="cards">{Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}</div>
      )}

      {data && data.length > 0 && (
        <motion.div className="cards" variants={staggerContainer} initial="hidden" animate="show">
          {data.map((app) => (
            <motion.div key={app.id} variants={fadeUp} className={`health-card health-card--${app.status}`} whileHover={{ y: -2 }}>
              <div className="health-card__head">
                <HealthDot status={app.status} />
                <strong>{app.name}</strong>
                <span className="muted small">{app.service}</span>
              </div>

              <div className="health-card__body">
                <RingGauge value={app.uptimePct} tone={ringTone(app.status)} label={`${app.uptimePct}% uptime`} />
                <dl className="metrics">
                  <div><dt>p95 latency</dt><dd>{app.latencyMsP95} ms</dd></div>
                  <div><dt>req/min</dt><dd>{app.requestsPerMin.toLocaleString()}</dd></div>
                </dl>
              </div>

              <Meter label="Error rate" value={app.errorRatePct} max={10} format={(v) => `${v}%`} tone={errorTone(app.errorRatePct)} />

              <span className="muted small">updated {timeAgo(app.updatedAt)}</span>
            </motion.div>
          ))}
        </motion.div>
      )}

      {data && data.length === 0 && (
        <EmptyState icon={<ServerOff size={20} />} title="No applications registered" description={<>Run <code>npm run seed</code> to populate demo data.</>} />
      )}
    </div>
  );
}
