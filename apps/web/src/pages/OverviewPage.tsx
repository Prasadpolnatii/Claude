import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { AlertOctagon, Layers, RefreshCw, ServerCog, Siren } from "lucide-react";
import { getOverview } from "../api/client.js";
import { useAsync } from "../hooks/useAsync.js";
import type { Tab } from "../nav.js";
import { AnimatedNumber } from "../components/ui/AnimatedNumber.js";
import { StatCardSkeleton } from "../components/ui/Skeleton.js";
import { ErrorNote } from "../components/ui/ErrorNote.js";
import { fadeUp, staggerContainer } from "../components/ui/motion.js";

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
        <button className="btn-ghost" onClick={reload}><RefreshCw size={14} /> Refresh</button>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {loading && !data && (
        <div className="cards">
          {Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}
        </div>
      )}

      {data && (
        <>
          <motion.div className="cards" variants={staggerContainer} initial="hidden" animate="show">
            <StatCard
              icon={<Siren size={17} />}
              label="Open incidents"
              value={data.incidents.open}
              onClick={() => onNavigate("incidents")}
              sub={
                <>
                  <span className="sev sev--sev1">{data.incidents.bySeverity.sev1} SEV1</span>
                  <span className="sev sev--sev2">{data.incidents.bySeverity.sev2} SEV2</span>
                </>
              }
            />

            <StatCard
              icon={<AlertOctagon size={17} />}
              label="Firing alerts"
              value={data.alerts.firing}
              onClick={() => onNavigate("alerts")}
              sub={
                <>
                  <span className="alev alev--critical">{data.alerts.bySeverity.critical} critical</span>
                  <span className="alev alev--warning">{data.alerts.bySeverity.warning} warning</span>
                </>
              }
            />

            <StatCard
              icon={<ServerCog size={17} />}
              label="Applications"
              value={data.applications.healthy}
              valueSuffix={<span className="stat-card__value-suffix"> / {data.applications.total}</span>}
              onClick={() => onNavigate("health")}
              sub={
                <>
                  <span className="ok">healthy</span> · {data.applications.degraded} degraded · {data.applications.down} down
                </>
              }
            />

            <StatCard
              icon={<Layers size={17} />}
              label="Queues"
              value={data.queues.total}
              onClick={() => onNavigate("queues")}
              sub={<>{data.queues.critical} critical · {data.queues.warning} warning</>}
            />
          </motion.div>
          <p className="muted small page__updated">Updated {new Date(data.updatedAt).toLocaleTimeString()}</p>
        </>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  valueSuffix,
  sub,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  valueSuffix?: ReactNode;
  sub: ReactNode;
  onClick: () => void;
}) {
  return (
    <motion.button variants={fadeUp} className="stat-card stat-card--btn" onClick={onClick} whileHover={{ y: -3 }} whileTap={{ scale: 0.98 }}>
      <span className="stat-card__icon">{icon}</span>
      <span className="stat-card__label">{label}</span>
      <span className="stat-card__value">
        <AnimatedNumber value={value} />
        {valueSuffix}
      </span>
      <span className="stat-card__sub">{sub}</span>
    </motion.button>
  );
}
