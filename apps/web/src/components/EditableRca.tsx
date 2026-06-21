import { useState } from "react";
import type { GroundedResult, RcaDocument } from "@ops-copilot/shared";
import { AIBlock } from "./AIBlock.js";
import { saveRca, type SavedRca } from "../api/client.js";

/**
 * Human-edit-before-save workflow for an RCA document.
 *  - View: AIBlock chrome (confidence, citations, "verify before acting") with
 *    Edit + Save actions.
 *  - Edit: every field editable (title, root cause, and the three list fields as
 *    one-per-line). Save persists via POST /api/rca, flagging editedByHuman when
 *    the human changed anything.
 */
interface Props {
  result: GroundedResult<RcaDocument>;
  jobId?: string;
  incidentId?: string;
}

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export function EditableRca({ result, jobId, incidentId }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<RcaDocument>(result.data);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<SavedRca | null>(null);
  const [error, setError] = useState<string>();

  const changed = JSON.stringify(draft) !== JSON.stringify(result.data);

  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      const res = await saveRca({
        incidentId,
        jobId,
        title: draft.title,
        rootCause: draft.rootCause,
        contributingFactors: draft.contributingFactors.filter(Boolean),
        timeline: draft.timeline.filter(Boolean),
        remediation: draft.remediation.filter(Boolean),
        confidence: result.confidence,
        citations: result.citations,
        editedByHuman: changed,
      });
      setSaved(res.rca);
      setEditing(false);
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
          <h3>Edit RCA before saving</h3>
          <span className="ai-block__badge">Your edits are authoritative</span>
        </header>
        <label>Title<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
        <label>Root cause<textarea rows={3} value={draft.rootCause} onChange={(e) => setDraft({ ...draft, rootCause: e.target.value })} /></label>
        <label>Contributing factors (one per line)
          <textarea rows={3} value={draft.contributingFactors.join("\n")} onChange={(e) => setDraft({ ...draft, contributingFactors: lines(e.target.value) })} />
        </label>
        <label>Timeline (one per line)
          <textarea rows={3} value={draft.timeline.join("\n")} onChange={(e) => setDraft({ ...draft, timeline: lines(e.target.value) })} />
        </label>
        <label>Remediation (one per line)
          <textarea rows={3} value={draft.remediation.join("\n")} onChange={(e) => setDraft({ ...draft, remediation: lines(e.target.value) })} />
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
      <AIBlock<RcaDocument> title="Root cause analysis" result={result} onEdit={() => setEditing(true)}>
        {(d) => (
          <>
            <strong>{d.title}</strong>
            <p><b>Root cause:</b> {d.rootCause}</p>
            {d.contributingFactors.length > 0 && <p className="muted">Contributing: {d.contributingFactors.join("; ")}</p>}
            {d.timeline.length > 0 && (
              <>
                <p className="muted">Timeline:</p>
                <ol>{d.timeline.map((t, i) => <li key={i}>{t}</li>)}</ol>
              </>
            )}
            <p className="muted">Remediation:</p>
            <ol>{d.remediation.map((r, i) => <li key={i}>{r}</li>)}</ol>
          </>
        )}
      </AIBlock>
      <div className="workspace__actions">
        <button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save RCA"}</button>
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
