import { useRef, useState } from "react";
import type { SopSearchAnswer } from "@ops-copilot/shared";
import { searchSops, searchSopsGrounded, uploadSop, ApiCallError } from "../api/client.js";
import { useJobStream } from "../hooks/useJob.js";
import { AIBlock } from "../components/AIBlock.js";

/**
 * SOP Search end to end:
 *   upload runbook (PDF/.md/.txt) → chunk + embed + store →
 *   grounded answer (async job → SSE, citations + confidence in AIBlock) and
 *   instant raw retrieval. Works in mock mode with no MongoDB.
 */
export function SopSearch() {
  const [q, setQ] = useState("database failover");
  const [hits, setHits] = useState<Array<{ id: string; title: string; text: string; score: number }>>([]);
  const [retrErr, setRetrErr] = useState<string>();
  const [uploadMsg, setUploadMsg] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const answer = useJobStream<SopSearchAnswer>();

  async function onUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg(undefined);
    try {
      const r = await uploadSop(file);
      setUploadMsg(`Indexed “${r.document}” — ${r.chunks} chunk${r.chunks === 1 ? "" : "s"} from ${r.characters} chars.`);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      setUploadMsg(`Upload failed: ${e instanceof ApiCallError ? e.message : String(e)}`);
    } finally {
      setUploading(false);
    }
  }

  async function retrieve() {
    setRetrErr(undefined);
    try {
      const res = await searchSops(q);
      setHits(res.hits);
    } catch (e) {
      setRetrErr(e instanceof ApiCallError ? e.message : String(e));
    }
  }

  return (
    <div className="sop">
      <div className="sop__upload">
        <input ref={fileRef} type="file" accept=".pdf,.md,.txt,text/plain,text/markdown,application/pdf" />
        <button onClick={onUpload} disabled={uploading}>{uploading ? "Indexing…" : "Upload runbook"}</button>
        {uploadMsg && <span className="muted">{uploadMsg}</span>}
      </div>

      <div className="sop__search">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask the runbooks…" />
        <button onClick={retrieve}>Search</button>
        <button onClick={() => answer.run(() => searchSopsGrounded(q))} disabled={answer.streaming}>
          Grounded answer
        </button>
      </div>

      {retrErr && <div className="error-note" role="alert">{retrErr}</div>}

      {(answer.streaming || answer.result || answer.error) && (
        <AIBlock<SopSearchAnswer>
          title="Grounded answer"
          streaming={answer.streaming}
          streamText={answer.streamText}
          result={answer.result}
        >
          {(d) => <p>{d.answer}</p>}
        </AIBlock>
      )}
      {answer.error && (
        <div className="error-note" role="alert">
          <strong>{answer.error.code}</strong> — {answer.error.message}
        </div>
      )}

      <ul className="sop__hits">
        {hits.map((h) => (
          <li key={h.id}>
            <div className="sop__hit-head">
              <strong>{h.title}</strong>
              <span className="muted">{(h.score * 100).toFixed(0)}% match</span>
            </div>
            <p>{h.text}</p>
          </li>
        ))}
        {hits.length === 0 && !retrErr && <li className="muted">No results yet — upload a runbook, then search.</li>}
      </ul>
    </div>
  );
}
