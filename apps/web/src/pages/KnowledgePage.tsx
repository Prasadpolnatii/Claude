import { useEffect, useState } from "react";
import type { KnowledgeArticle } from "@ops-copilot/shared";
import { listKnowledge } from "../api/client.js";
import { useAsync } from "../hooks/useAsync.js";
import { Markdownish } from "../components/Markdownish.js";

/** Knowledge base: searchable list on the left, article viewer on the right. */
export function KnowledgePage() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const { data, error, loading } = useAsync(() => listKnowledge(query), [query]);
  const [selected, setSelected] = useState<KnowledgeArticle | null>(null);

  // Keep a valid selection as the list changes (default to the first result).
  useEffect(() => {
    if (!data) return;
    setSelected((cur) => (cur && data.some((a) => a.id === cur.id) ? cur : data[0] ?? null));
  }, [data]);

  return (
    <div className="page">
      <div className="page__head">
        <h2>Knowledge base</h2>
        <form
          className="inline-search"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(q.trim());
          }}
        >
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search articles…" aria-label="Search knowledge base" />
          <button className="btn">Search</button>
        </form>
      </div>

      {error && <div className="error-note" role="alert">{error}</div>}

      <div className="split">
        <aside className="list-pane">
          {loading && !data && <p className="muted">Loading…</p>}
          <ul className="article-list">
            {data?.map((a) => (
              <li key={a.id}>
                <button className={selected?.id === a.id ? "active" : ""} onClick={() => setSelected(a)}>
                  <strong>{a.title}</strong>
                  <span className="muted small">{a.category}</span>
                </button>
              </li>
            ))}
            {data && data.length === 0 && <li className="muted">No articles match.</li>}
          </ul>
        </aside>

        <article className="viewer">
          {selected ? (
            <>
              <h3>{selected.title}</h3>
              <div className="tags">
                <span className="badge cat">{selected.category}</span>
                {selected.tags.map((t) => (
                  <span key={t} className="badge tag">#{t}</span>
                ))}
              </div>
              <Markdownish body={selected.body} />
            </>
          ) : (
            <p className="muted">Select an article to read it.</p>
          )}
        </article>
      </div>
    </div>
  );
}
