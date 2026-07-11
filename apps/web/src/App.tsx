import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  BookOpenText,
  Bell,
  FileSearch,
  HeartPulse,
  LayoutDashboard,
  Library,
  ListOrdered,
  LogOut,
  Moon,
  ShieldCheck,
  Siren,
  Sparkles,
  Sun,
} from "lucide-react";
import { currentRole, devLogin, getAuthConfig, getToken, setToken } from "./api/client.js";
import { useTheme } from "./theme.js";
import { NAV, type Tab } from "./nav.js";
import { PageTransition } from "./components/ui/PageTransition.js";
import { ErrorNote } from "./components/ui/ErrorNote.js";
import { EASE_OUT } from "./components/ui/motion.js";
import { OverviewPage } from "./pages/OverviewPage.js";
import { IncidentsPage } from "./pages/IncidentsPage.js";
import { AlertsPage } from "./pages/AlertsPage.js";
import { HealthPage } from "./pages/HealthPage.js";
import { QueuesPage } from "./pages/QueuesPage.js";
import { KnowledgePage } from "./pages/KnowledgePage.js";
import { AuditPage } from "./pages/AuditPage.js";
import { SopSearch } from "./pages/SopSearch.js";
import { RcaPage } from "./pages/RcaPage.js";

const NAV_ICONS: Record<Tab, typeof LayoutDashboard> = {
  overview: LayoutDashboard,
  incidents: Siren,
  alerts: Bell,
  health: HeartPulse,
  queues: ListOrdered,
  sop: BookOpenText,
  rca: FileSearch,
  knowledge: Library,
  audit: ShieldCheck,
};

/**
 * App shell — responsive sidebar nav, dark/light theme toggle, role-aware
 * navigation (admins additionally see the Audit log). Auth is a dev JWT pasted
 * from `npm run seed`; in production this is replaced by a real login.
 */
export function App() {
  const [token, setTok] = useState(getToken());
  const [tab, setTab] = useState<Tab>("overview");
  const [theme, toggleTheme] = useTheme();

  const role = useMemo(() => (token ? currentRole() : "engineer"), [token]);

  if (!token) return <TokenGate onSet={(t) => { setToken(t); setTok(t); }} />;

  const items = NAV.filter((n) => !n.roles || n.roles.includes(role));

  function logout() {
    localStorage.removeItem("ops_token");
    setToken("");
    setTok("");
  }

  return (
    <div className="shell">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__brand-mark"><Sparkles size={15} strokeWidth={2.25} /></span>
          Ops Copilot
        </div>
        <nav className="sidebar__nav" aria-label="Main navigation">
          {items.map((n) => {
            const Icon = NAV_ICONS[n.id];
            const active = tab === n.id;
            return (
              <button
                key={n.id}
                className={active ? "navbtn active" : "navbtn"}
                aria-current={active ? "page" : undefined}
                onClick={() => setTab(n.id)}
              >
                {active && (
                  <motion.span className="nav-indicator" layoutId="nav-indicator" transition={{ type: "spring", stiffness: 500, damping: 40 }} />
                )}
                <Icon size={16} strokeWidth={2} aria-hidden="true" />
                {n.label}
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="content">
        <header className="topbar glass">
          <h1 className="topbar__title">On-call Operations Dashboard</h1>
          <div className="topbar__right">
            <span className={`role-badge role-badge--${role}`}>{role}</span>
            <button className="icon-btn" onClick={toggleTheme} title="Toggle theme" aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={theme}
                  initial={{ opacity: 0, rotate: -60, scale: 0.6 }}
                  animate={{ opacity: 1, rotate: 0, scale: 1 }}
                  exit={{ opacity: 0, rotate: 60, scale: 0.6 }}
                  transition={{ duration: 0.22, ease: EASE_OUT }}
                  style={{ display: "flex" }}
                >
                  {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
                </motion.span>
              </AnimatePresence>
            </button>
            <button className="btn-ghost" onClick={logout}>
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </header>

        <main className="main" id="main-content" tabIndex={-1}>
          <AnimatePresence mode="wait">
            <PageTransition key={tab}>
              {tab === "overview" && <OverviewPage onNavigate={setTab} />}
              {tab === "incidents" && <IncidentsPage role={role} />}
              {tab === "alerts" && <AlertsPage />}
              {tab === "health" && <HealthPage />}
              {tab === "queues" && <QueuesPage />}
              {tab === "sop" && <SopSearch />}
              {tab === "rca" && <RcaPage />}
              {tab === "knowledge" && <KnowledgePage />}
              {tab === "audit" && role === "admin" && <AuditPage />}
            </PageTransition>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

function TokenGate({ onSet }: { onSet: (t: string) => void }) {
  const [v, setV] = useState("");
  const [devLoginOn, setDevLoginOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  useEffect(() => {
    getAuthConfig().then((c) => setDevLoginOn(c.devLogin)).catch(() => setDevLoginOn(false));
  }, []);

  async function demo(role: "admin" | "engineer") {
    setBusy(true);
    setErr(undefined);
    try {
      onSet(await devLogin(role));
    } catch {
      setErr("Demo login failed.");
      setBusy(false);
    }
  }

  return (
    <div className="gate-wrap">
      <motion.div className="gate" initial={{ opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.4, ease: EASE_OUT }}>
        <span className="gate__brand"><Activity size={24} strokeWidth={2.25} /></span>
        <h1>AI Operations Dashboard</h1>
        <p>Grounded RCA, SOP search, and ticket summarization for on-call engineers.</p>

        {devLoginOn && (
          <div className="gate__demo">
            <p className="muted small" style={{ marginTop: 20, marginBottom: 10 }}>Try the live demo — no token needed:</p>
            <div className="gate__demo-btns">
              <button className="btn" disabled={busy} onClick={() => demo("admin")}>Enter demo as Admin</button>
              <button className="btn-ghost" disabled={busy} onClick={() => demo("engineer")}>Enter as Engineer</button>
            </div>
            {err && <ErrorNote>{err}</ErrorNote>}
            <hr />
          </div>
        )}
        <p className="muted small">
          Or paste a dev JWT printed by <code>npm run seed</code> — an <strong>admin</strong> token
          (full access incl. audit log) or an <strong>engineer</strong> token.
        </p>
        <textarea value={v} onChange={(e) => setV(e.target.value)} rows={4} placeholder="eyJ…" aria-label="Paste JWT token" />
        <button className="btn" disabled={!v.trim()} onClick={() => onSet(v.trim())}>
          Enter
        </button>
      </motion.div>
    </div>
  );
}
