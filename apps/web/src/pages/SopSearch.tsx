import { useState } from "react";
import type { SopSearchAnswer } from "@ops-copilot/shared";
import { searchSops, ApiCallError } from "../api/client.js";
import { useJob } from "../hooks/useJob.js";
import { AIBlock } from "../components/AIBlock.js";

/**
 * SOP search. Two modes:
 *   - instant retrieval (GET /api/sops/search) — fast, no LLM, shows raw hits
 *   - grounded answer (async job) — LLM answers strictly from retrieved runbooks
 */
export function SopSearch() {
  const [q, setQ] = useState("database failover");
  const [hits, setHits] = useState<Array<{ id: string; title: string; text: string; score: number }>>([]);
  const [retrErr, setRetrErr] = useState<string>();
  const answer = useJob<SopSearchAnswer>("sop_search");

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
      <div className="sop__search">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask the runbooks…" />
        <button onClick={retrieve}>Search</button>
        <button onClick={() => answer.run({ query: q })} disabled={answer.streaming}>
          Grounded answer
        </button>
      </div>

      {retrErr && <div className="error-note" role="alert">{retrErr}</div>}

      {(answer.streaming || answer.result) && (
        <AIBlock<SopSearchAnswer>
          title="Grounded answer"
          streaming={answer.streaming}
          streamText={answer.streamText}
          result={answer.result}
        >
          {(d) => <p>{d.answer}</p>}
        </AIBlock>
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
        {hits.length === 0 && !retrErr && <li className="muted">No results yet — run a search.</li>}
      </ul>
    </div>
  );
}
