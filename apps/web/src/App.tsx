import { useState } from "react";
import { getToken, setToken } from "./api/client.js";
import { IncidentWorkspace } from "./pages/IncidentWorkspace.js";
import { SopSearch } from "./pages/SopSearch.js";
import { RcaPage } from "./pages/RcaPage.js";

type Tab = "workspace" | "sop" | "rca";

export function App() {
  const [tab, setTab] = useState<Tab>("workspace");
  const [token, setTok] = useState(getToken());

  if (!token) return <TokenGate onSet={(t) => { setToken(t); setTok(t); }} />;

  return (
    <div className="app">
      <header className="app__bar">
        <strong>AI Operations Copilot</strong>
        <nav>
          <button className={tab === "workspace" ? "active" : ""} onClick={() => setTab("workspace")}>
            Incident Workspace
          </button>
          <button className={tab === "sop" ? "active" : ""} onClick={() => setTab("sop")}>
            SOP Search
          </button>
          <button className={tab === "rca" ? "active" : ""} onClick={() => setTab("rca")}>
            RCA
          </button>
        </nav>
      </header>
      <main className="app__main">
        {tab === "workspace" && <IncidentWorkspace />}
        {tab === "sop" && <SopSearch />}
        {tab === "rca" && <RcaPage />}
      </main>
    </div>
  );
}

function TokenGate({ onSet }: { onSet: (t: string) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="gate">
      <h1>AI Operations Copilot</h1>
      <p>Paste the dev JWT printed by <code>npm run seed</code>.</p>
      <textarea value={v} onChange={(e) => setV(e.target.value)} rows={4} placeholder="eyJ…" />
      <button disabled={!v.trim()} onClick={() => onSet(v.trim())}>
        Enter
      </button>
    </div>
  );
}
