import { useState } from "react";
import type { RcaDocument, TicketSummary } from "@ops-copilot/shared";
import { useJob } from "../hooks/useJob.js";
import { AIBlock } from "../components/AIBlock.js";

/**
 * The hub. One incident, with the core-3 outputs side by side. Each generative
 * action goes through the async job + SSE path and renders in an AIBlock so the
 * trust guarantees (citations, confidence, verify-before-acting) always show.
 */
export function IncidentWorkspace() {
  const [ticketText, setTicketText] = useState(
    "Customers report checkout taking 8+ seconds since ~14:05, right after the 2.4.1 deploy.",
  );
  const [logSnippet, setLogSnippet] = useState(
    "14:09 ERROR pool: connection pool timeout (size=20, waiting=312)\n14:10 WARN retry storm detected",
  );

  const summary = useJob<TicketSummary>("ticket_summary");
  const rca = useJob<RcaDocument>("rca");

  return (
    <div className="workspace">
      <div className="workspace__inputs">
        <label>
          Ticket
          <textarea value={ticketText} onChange={(e) => setTicketText(e.target.value)} rows={4} />
        </label>
        <label>
          Log snippet (attached evidence for RCA)
          <textarea value={logSnippet} onChange={(e) => setLogSnippet(e.target.value)} rows={4} />
        </label>
        <div className="workspace__actions">
          <button onClick={() => summary.run({ ticketText })} disabled={summary.streaming}>
            Summarize ticket
          </button>
          <button onClick={() => rca.run({ incidentSummary: ticketText, logSnippet })} disabled={rca.streaming}>
            Generate RCA
          </button>
        </div>
      </div>

      <div className="workspace__outputs">
        {(summary.streaming || summary.result || summary.error) && (
          <AIBlock<TicketSummary>
            title="Ticket summary"
            streaming={summary.streaming}
            streamText={summary.streamText}
            result={summary.result}
            onEdit={() => alert("Opens an editable draft (stub).")}
          >
            {(d) => (
              <>
                <strong>{d.headline}</strong>
                <p>{d.summary}</p>
                <p className="muted">Impact: {d.impact}</p>
                <ul>{d.nextActions.map((a, i) => <li key={i}>{a}</li>)}</ul>
              </>
            )}
          </AIBlock>
        )}
        {summary.error && <ErrorNote {...summary.error} onRetry={() => summary.run({ ticketText })} />}

        {(rca.streaming || rca.result || rca.error) && (
          <AIBlock<RcaDocument>
            title="Root cause analysis"
            streaming={rca.streaming}
            streamText={rca.streamText}
            result={rca.result}
            onEdit={() => alert("Opens an editable RCA draft (stub).")}
          >
            {(d) => (
              <>
                <strong>{d.title}</strong>
                <p><b>Root cause:</b> {d.rootCause}</p>
                <p className="muted">Contributing: {d.contributingFactors.join(", ")}</p>
                <ol>{d.remediation.map((r, i) => <li key={i}>{r}</li>)}</ol>
              </>
            )}
          </AIBlock>
        )}
        {rca.error && <ErrorNote {...rca.error} onRetry={() => rca.run({ incidentSummary: ticketText, logSnippet })} />}
      </div>
    </div>
  );
}

function ErrorNote({ code, message, retryable, onRetry }: { code: string; message: string; retryable: boolean; onRetry: () => void }) {
  return (
    <div className="error-note" role="alert">
      <strong>{code}</strong> — {message}
      {retryable && <button className="link" onClick={onRetry}>Retry</button>}
    </div>
  );
}
