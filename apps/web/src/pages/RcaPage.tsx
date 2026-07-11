import { useState } from "react";
import { Sparkles } from "lucide-react";
import type { RcaDocument } from "@ops-copilot/shared";
import { generateRca } from "../api/client.js";
import { useJobStream } from "../hooks/useJob.js";
import { AIBlock } from "../components/AIBlock.js";
import { EditableRca } from "../components/EditableRca.js";
import { ErrorNote } from "../components/ui/ErrorNote.js";

/**
 * RCA Generation end to end:
 *   incident summary + log snippet → Generate → retrieves SOP chunks, redacts,
 *   generates a grounded RCA → SSE stream → AIBlock (citations + confidence) →
 *   human edit → save. Works in mock mode with no MongoDB (generation); save
 *   needs Mongo.
 */
export function RcaPage() {
  const [incidentSummary, setIncidentSummary] = useState(
    "Checkout returning 5xx for ~8% of requests since the 2.4.1 deploy at 14:05.",
  );
  const [logSnippet, setLogSnippet] = useState(
    "14:09 ERROR pool: connection pool timeout (size=20, waiting=312)\n14:10 WARN retry storm detected",
  );
  const [jobId, setJobId] = useState<string>();
  const rca = useJobStream<RcaDocument>();

  async function run() {
    await rca.run(async () => {
      const r = await generateRca(incidentSummary, logSnippet);
      setJobId(r.jobId);
      return r;
    });
  }

  return (
    <div className="page">
      <div className="page__head"><h2>Root cause analysis</h2></div>
      <div className="rca">
        <div className="rca__inputs">
          <label>
            Incident summary
            <textarea rows={3} value={incidentSummary} onChange={(e) => setIncidentSummary(e.target.value)} />
          </label>
          <label>
            Log snippet (grounding evidence)
            <textarea rows={4} value={logSnippet} onChange={(e) => setLogSnippet(e.target.value)} />
          </label>
          <button className="btn" onClick={run} disabled={rca.streaming}>
            <Sparkles size={14} /> {rca.streaming ? "Generating…" : "Generate RCA"}
          </button>
        </div>

        <div className="rca__output">
          {rca.streaming && <AIBlock<RcaDocument> title="Root cause analysis" streaming streamText={rca.streamText} />}

          {!rca.streaming && rca.result && (
            <EditableRca result={rca.result} jobId={jobId} />
          )}

          {rca.error && (
            <ErrorNote>
              <code>{rca.error.code}</code> — {rca.error.message}
              {rca.error.retryable && <> <button className="link" onClick={run}>Retry</button></>}
            </ErrorNote>
          )}
        </div>
      </div>
    </div>
  );
}
