import { useEffect, useState } from "react";
import type { TicketSummary } from "@ops-copilot/shared";
import {
  getTicketSummary,
  listTickets,
  summarizeTicket,
  type SavedSummary,
  type TicketRow,
} from "../api/client.js";
import { useJobStream } from "../hooks/useJob.js";
import { AIBlock } from "../components/AIBlock.js";
import { EditableSummary } from "../components/EditableSummary.js";

/**
 * Incident Workspace — Ticket Summarization end to end:
 *   inbox → select a ticket → Summarize → SSE stream → grounded AIBlock →
 *   human edit → save. Re-selecting a ticket loads any previously saved summary.
 */
export function IncidentWorkspace() {
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [loadErr, setLoadErr] = useState<{ code: string; message: string }>();
  const [selected, setSelected] = useState<TicketRow>();
  const [savedSummary, setSavedSummary] = useState<SavedSummary | null>(null);
  const [jobId, setJobId] = useState<string>();

  const job = useJobStream<TicketSummary>();

  useEffect(() => {
    listTickets()
      .then((r) => setTickets(r.tickets))
      .catch((e) => setLoadErr({ code: e.code ?? "error", message: e.message ?? String(e) }));
  }, []);

  async function select(t: TicketRow) {
    setSelected(t);
    job.reset();
    setJobId(undefined);
    setSavedSummary(null);
    try {
      const r = await getTicketSummary(t._id);
      setSavedSummary(r.summary);
    } catch {
      /* no saved summary / DB down — fine */
    }
  }

  async function runSummarize() {
    if (!selected) return;
    setSavedSummary(null);
    await job.run(async () => {
      const r = await summarizeTicket(selected._id);
      setJobId(r.jobId);
      return r;
    });
  }

  if (loadErr) {
    return (
      <div className="error-note" role="alert">
        Couldn’t load tickets ({loadErr.code}): {loadErr.message}
        {loadErr.code === "db_unavailable" && " — ticket features need MongoDB."}
      </div>
    );
  }

  return (
    <div className="workspace">
      <aside className="inbox">
        <h3>Tickets</h3>
        {tickets.length === 0 && <p className="muted">No tickets. Seed some with <code>npm run seed</code>.</p>}
        <ul>
          {tickets.map((t) => (
            <li key={t._id}>
              <button className={selected?._id === t._id ? "active" : ""} onClick={() => select(t)}>
                {t.title}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="workspace__outputs">
        {!selected && <p className="muted">Select a ticket to summarize.</p>}

        {selected && (
          <>
            <div className="ticket-body">
              <h3>{selected.title}</h3>
              <p>{selected.body}</p>
              <button onClick={runSummarize} disabled={job.streaming}>
                {job.streaming ? "Summarizing…" : "Summarize"}
              </button>
            </div>

            {job.streaming && (
              <AIBlock<TicketSummary> title="Ticket summary" streaming streamText={job.streamText} />
            )}

            {!job.streaming && job.result && (
              <EditableSummary
                ticketId={selected._id}
                jobId={jobId}
                result={job.result}
                initiallySaved={savedSummary}
                onSaved={setSavedSummary}
              />
            )}

            {job.error && (
              <div className="error-note" role="alert">
                <strong>{job.error.code}</strong> — {job.error.message}
                {job.error.retryable && <button className="link" onClick={runSummarize}>Retry</button>}
              </div>
            )}

            {!job.result && !job.streaming && savedSummary && (
              <div className="saved-summary">
                <h4>Saved summary {savedSummary.editedByHuman ? "(human-edited)" : ""}</h4>
                <strong>{savedSummary.headline}</strong>
                <p>{savedSummary.summary}</p>
                <p className="muted">Impact: {savedSummary.impact}</p>
                <ul>{savedSummary.nextActions.map((a, i) => <li key={i}>{a}</li>)}</ul>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
