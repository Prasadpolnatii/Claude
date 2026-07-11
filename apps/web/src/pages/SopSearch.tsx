import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { FileUp, Search, Sparkles } from "lucide-react";
import type { SopSearchAnswer } from "@ops-copilot/shared";
import { searchSops, searchSopsGrounded, uploadSop, ApiCallError } from "../api/client.js";
import { useJobStream } from "../hooks/useJob.js";
import { AIBlock } from "../components/AIBlock.js";
import { ErrorNote } from "../components/ui/ErrorNote.js";
import { EmptyState } from "../components/ui/EmptyState.js";
import { fadeUp, staggerContainer } from "../components/ui/motion.js";

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
    <div className="page sop">
      <div className="page__head"><h2>SOP search</h2></div>

      <div className="sop__upload">
        <input ref={fileRef} type="file" accept=".pdf,.md,.txt,text/plain,text/markdown,application/pdf" aria-label="Runbook file" />
        <button className="btn-ghost" onClick={onUpload} disabled={uploading}><FileUp size={14} /> {uploading ? "Indexing…" : "Upload runbook"}</button>
        {uploadMsg && <span className="muted small">{uploadMsg}</span>}
      </div>

      <div className="sop__search">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask the runbooks…" aria-label="Search query" />
        <button className="btn-ghost" onClick={retrieve}><Search size={14} /> Search</button>
        <button className="btn" onClick={() => answer.run(() => searchSopsGrounded(q))} disabled={answer.streaming}>
          <Sparkles size={14} /> Grounded answer
        </button>
      </div>

      {retrErr && <ErrorNote>{retrErr}</ErrorNote>}

      {(answer.streaming || answer.result || answer.error) && (
        <div style={{ marginTop: 16 }}>
          <AIBlock<SopSearchAnswer>
            title="Grounded answer"
            streaming={answer.streaming}
            streamText={answer.streamText}
            result={answer.result}
          >
            {(d) => <p>{d.answer}</p>}
          </AIBlock>
        </div>
      )}
      {answer.error && (
        <ErrorNote title={answer.error.code}>{answer.error.message}</ErrorNote>
      )}

      <motion.ul className="sop__hits" variants={staggerContainer} initial="hidden" animate="show" style={{ marginTop: 16 }}>
        {hits.map((h) => (
          <motion.li key={h.id} variants={fadeUp}>
            <div className="sop__hit-head">
              <strong>{h.title}</strong>
              <span className="muted small">{(h.score * 100).toFixed(0)}% match</span>
            </div>
            <p className="muted" style={{ marginBottom: 0 }}>{h.text}</p>
          </motion.li>
        ))}
      </motion.ul>
      {hits.length === 0 && !retrErr && (
        <EmptyState icon={<Search size={20} />} title="No results yet" description="Upload a runbook, then search." />
      )}
    </div>
  );
}
