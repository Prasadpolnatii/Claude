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
            <motion.button variants={fadeUp} className="stat-card stat-card--btn" onClick={() => onNavigate("incidents")} whileHover={{ y: -3 }} whileTap={{ scale: 0.98 }}>
              <span className="stat-card__icon"><Siren size={17} /></span>
              <span className="stat-card__label">Open incidents</span>
              <span className="stat-card__value"><AnimatedNumber value={data.incidents.open} /></span>
              <span className="stat-card__sub">
                <span className="sev sev--sev1">{data.incidents.bySeverity.sev1} SEV1</span>
                <span className="sev sev--sev2">{data.incidents.bySeverity.sev2} SEV2</span>
              </span>
            </motion.button>

            <motion.button variants={fadeUp} className="stat-card stat-card--btn" onClick={() => onNavigate("alerts")} whileHover={{ y: -3 }} whileTap={{ scale: 0.98 }}>
              <span className="stat-card__icon"><AlertOctagon size={17} /></span>
              <span className="stat-card__label">Firing alerts</span>
              <span className="stat-card__value"><AnimatedNumber value={data.alerts.firing} /></span>
              <span className="stat-card__sub">
                <span className="alev alev--critical">{data.alerts.bySeverity.critical} critical</span>
                <span className="alev alev--warning">{data.alerts.bySeverity.warning} warning</span>
              </span>
            </motion.button>

            <motion.button variants={fadeUp} className="stat-card stat-card--btn" onClick={() => onNavigate("health")} whileHover={{ y: -3 }} whileTap={{ scale: 0.98 }}>
              <span className="stat-card__icon"><ServerCog size={17} /></span>
              <span className="stat-card__label">Applications</span>
              <span className="stat-card__value">
                <AnimatedNumber value={data.applications.healthy} />
                <span className="muted" style={{ fontSize: "0.55em", fontWeight: 600 }}> / {data.applications.total}</span>
              </span>
              <span className="stat-card__sub">
                <span className="ok">healthy</span> · {data.applications.degraded} degraded · {data.applications.down} down
              </span>
            </motion.button>

            <motion.button variants={fadeUp} className="stat-card stat-card--btn" onClick={() => onNavigate("queues")} whileHover={{ y: -3 }} whileTap={{ scale: 0.98 }}>
              <span className="stat-card__icon"><Layers size={17} /></span>
              <span className="stat-card__label">Queues</span>
              <span className="stat-card__value"><AnimatedNumber value={data.queues.total} /></span>
              <span className="stat-card__sub">
                {data.queues.critical} critical · {data.queues.warning} warning
              </span>
            </motion.button>
          </motion.div>
          <p className="muted small" style={{ marginTop: 16 }}>Updated {new Date(data.updatedAt).toLocaleTimeString()}</p>
        </>
      )}
    </div>
  );
}
