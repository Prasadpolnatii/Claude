import { useEffect } from "react";
import type { IncidentReport } from "../api/client.js";

/**
 * Printable incident report → "Export to PDF".
 *
 * Rather than pull in a PDF library, we render a print-optimized layout and use
 * the browser's native print-to-PDF (File → Save as PDF). `@media print` CSS in
 * styles.css hides the app chrome and shows only `.print-area`. On mount we
 * trigger `window.print()`; `afterprint` (or a fallback timer) clears the report.
 */
export function IncidentReportPrint({ report, onDone }: { report: IncidentReport; onDone: () => void }) {
  useEffect(() => {
    const cleanup = () => onDone();
    window.addEventListener("afterprint", cleanup, { once: true });
    // Let the DOM paint before invoking the print dialog.
    const t = setTimeout(() => window.print(), 80);
    // Safety net if `afterprint` never fires (some browsers/headless).
    const fallback = setTimeout(cleanup, 60_000);
    return () => {
      window.removeEventListener("afterprint", cleanup);
      clearTimeout(t);
      clearTimeout(fallback);
    };
  }, [onDone]);

  const { incident, relatedAlerts, generatedAt, durationMinutes } = report;

  return (
    <div className="print-area">
      <header className="print-head">
        <h1>Incident Report</h1>
        <p className="muted">Generated {new Date(generatedAt).toLocaleString()}</p>
      </header>

      <section>
        <h2>{incident.title}</h2>
        <table className="kv">
          <tbody>
            <tr><th>Severity</th><td>{incident.severity.toUpperCase()}</td></tr>
            <tr><th>Status</th><td>{incident.status}</td></tr>
            <tr><th>Service</th><td>{incident.service}</td></tr>
            <tr><th>Started</th><td>{new Date(incident.startedAt).toLocaleString()}</td></tr>
            {incident.resolvedAt && <tr><th>Resolved</th><td>{new Date(incident.resolvedAt).toLocaleString()}</td></tr>}
            {durationMinutes != null && <tr><th>Duration</th><td>{durationMinutes} min</td></tr>}
            {incident.acknowledgedBy && <tr><th>Acknowledged by</th><td>{incident.acknowledgedBy}</td></tr>}
          </tbody>
        </table>
      </section>

      {incident.summary && (
        <section>
          <h3>Summary</h3>
          <p>{incident.summary}</p>
        </section>
      )}

      {incident.logSnippet && (
        <section>
          <h3>Log snippet</h3>
          <pre className="log">{incident.logSnippet}</pre>
        </section>
      )}

      <section>
        <h3>Timeline</h3>
        <ol className="print-timeline">
          {incident.timeline.map((e, i) => (
            <li key={i}>
              <strong>{new Date(e.at).toLocaleString()}</strong> — [{e.kind}] {e.message}
              {e.actor ? ` (${e.actor})` : ""}
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h3>Related alerts ({relatedAlerts.length})</h3>
        {relatedAlerts.length ? (
          <ul>
            {relatedAlerts.map((a) => (
              <li key={a.id}>
                [{a.severity}] {a.title} — {a.service} {a.value ? `(${a.value})` : ""} · {new Date(a.at).toLocaleString()}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">None recorded during the incident window.</p>
        )}
      </section>
    </div>
  );
}
