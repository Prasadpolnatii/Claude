import { useEffect, useMemo, useState } from "react";
import { currentRole, devLogin, getAuthConfig, getToken, setToken } from "./api/client.js";
import { useTheme } from "./theme.js";
import { NAV, type Tab } from "./nav.js";
import { OverviewPage } from "./pages/OverviewPage.js";
import { IncidentsPage } from "./pages/IncidentsPage.js";
import { AlertsPage } from "./pages/AlertsPage.js";
import { HealthPage } from "./pages/HealthPage.js";
import { QueuesPage } from "./pages/QueuesPage.js";
import { KnowledgePage } from "./pages/KnowledgePage.js";
import { AuditPage } from "./pages/AuditPage.js";
import { SopSearch } from "./pages/SopSearch.js";
import { RcaPage } from "./pages/RcaPage.js";

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
      <aside className="sidebar">
        <div className="sidebar__brand">⚙️ Ops Copilot</div>
        <nav className="sidebar__nav">
          {items.map((n) => (
            <button key={n.id} className={tab === n.id ? "navbtn active" : "navbtn"} onClick={() => setTab(n.id)}>
              {n.label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="content">
        <header className="topbar">
          <span className="topbar__title">On-call Operations Dashboard</span>
          <div className="topbar__right">
            <span className={`role-badge role-badge--${role}`}>{role}</span>
            <button className="btn-ghost" onClick={toggleTheme} title="Toggle theme">
              {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
            </button>
            <button className="btn-ghost" onClick={logout}>Sign out</button>
          </div>
        </header>

        <main className="main">
          {tab === "overview" && <OverviewPage onNavigate={setTab} />}
          {tab === "incidents" && <IncidentsPage role={role} />}
          {tab === "alerts" && <AlertsPage />}
          {tab === "health" && <HealthPage />}
          {tab === "queues" && <QueuesPage />}
          {tab === "sop" && <SopSearch />}
          {tab === "rca" && <RcaPage />}
          {tab === "knowledge" && <KnowledgePage />}
          {tab === "audit" && role === "admin" && <AuditPage />}
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
    <div className="gate">
      <h1>⚙️ AI Operations Dashboard</h1>
      {devLoginOn && (
        <div className="gate__demo">
          <p>Try the live demo — no token needed:</p>
          <div className="gate__demo-btns">
            <button disabled={busy} onClick={() => demo("admin")}>Enter demo as Admin</button>
            <button className="btn-ghost" disabled={busy} onClick={() => demo("engineer")}>Enter as Engineer</button>
          </div>
          {err && <p className="error-note" role="alert">{err}</p>}
          <hr />
        </div>
      )}
      <p>
        Or paste a dev JWT printed by <code>npm run seed</code> — an <strong>admin</strong> token
        (full access incl. audit log) or an <strong>engineer</strong> token.
      </p>
      <textarea value={v} onChange={(e) => setV(e.target.value)} rows={4} placeholder="eyJ…" />
      <button disabled={!v.trim()} onClick={() => onSet(v.trim())}>
        Enter
      </button>
    </div>
  );
}
