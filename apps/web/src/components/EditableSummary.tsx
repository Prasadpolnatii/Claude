import { useState } from "react";
import type { GroundedResult, TicketSummary } from "@ops-copilot/shared";
import { AIBlock } from "./AIBlock.js";
import { saveTicketSummary, type SavedSummary } from "../api/client.js";

/**
 * Human-edit-before-save workflow for a ticket summary.
 *
 *  - View mode: renders the AI draft via AIBlock (confidence, citations, the
 *    "verify before acting" badge) with Edit + Save actions.
 *  - Edit mode: the four fields become inputs; Save persists via
 *    PUT /api/tickets/:id/summary, flagging editedByHuman when the human changed
 *    anything. Save-without-edit is allowed (accepting the draft as-is).
 */
interface Props {
  ticketId: string;
  jobId?: string;
  result: GroundedResult<TicketSummary>;
  initiallySaved?: SavedSummary | null;
  onSaved?: (s: SavedSummary) => void;
}

export function EditableSummary({ ticketId, jobId, result, initiallySaved, onSaved }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TicketSummary>(result.data);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<SavedSummary | null>(initiallySaved ?? null);
  const [error, setError] = useState<string>();

  const changed = JSON.stringify(draft) !== JSON.stringify(result.data);

  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      const res = await saveTicketSummary(ticketId, {
        headline: draft.headline,
        summary: draft.summary,
        impact: draft.impact,
        nextActions: draft.nextActions.filter((a) => a.trim() !== ""),
        editedByHuman: changed,
        jobId,
      });
      setSaved(res.summary);
      setEditing(false);
      onSaved?.(res.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <section className="ai-block">
        <header className="ai-block__head">
          <h3>Edit summary before saving</h3>
          <span className="ai-block__badge">Your edits are authoritative</span>
        </header>
        <label>
          Headline
          <input value={draft.headline} onChange={(e) => setDraft({ ...draft, headline: e.target.value })} />
        </label>
        <label>
          Summary
          <textarea rows={3} value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
        </label>
        <label>
          Impact
          <input value={draft.impact} onChange={(e) => setDraft({ ...draft, impact: e.target.value })} />
        </label>
        <label>
          Next actions (one per line)
          <textarea
            rows={3}
            value={draft.nextActions.join("\n")}
            onChange={(e) => setDraft({ ...draft, nextActions: e.target.value.split("\n") })}
          />
        </label>
        {error && <div className="error-note" role="alert">{error}</div>}
        <div className="workspace__actions">
          <button onClick={save} disabled={saving}>{saving ? "Saving…" : changed ? "Save edits" : "Save as-is"}</button>
          <button className="link" onClick={() => { setDraft(result.data); setEditing(false); }}>Cancel</button>
        </div>
      </section>
    );
  }

  return (
    <>
      <AIBlock<TicketSummary> title="Ticket summary" result={result} onEdit={() => setEditing(true)}>
        {(d) => (
          <>
            <strong>{d.headline}</strong>
            <p>{d.summary}</p>
            <p className="muted">Impact: {d.impact}</p>
            <ul>{d.nextActions.map((a, i) => <li key={i}>{a}</li>)}</ul>
          </>
        )}
      </AIBlock>
      <div className="workspace__actions">
        <button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save summary"}</button>
        <button className="link" onClick={() => setEditing(true)}>✎ Edit first</button>
      </div>
      {error && <div className="error-note" role="alert">{error}</div>}
      {saved && (
        <p className="muted" role="status">
          ✓ Saved {new Date(saved.updatedAt).toLocaleTimeString()} {saved.editedByHuman ? "(human-edited)" : "(accepted as drafted)"}
        </p>
      )}
    </>
  );
}
