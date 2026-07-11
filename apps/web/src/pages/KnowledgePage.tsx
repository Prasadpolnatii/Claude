import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, Search } from "lucide-react";
import type { KnowledgeArticle } from "@ops-copilot/shared";
import { listKnowledge } from "../api/client.js";
import { useAsync } from "../hooks/useAsync.js";
import { Markdownish } from "../components/Markdownish.js";
import { ErrorNote } from "../components/ui/ErrorNote.js";
import { EmptyState } from "../components/ui/EmptyState.js";
import { ListRowSkeleton } from "../components/ui/Skeleton.js";
import { fade } from "../components/ui/motion.js";

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
          <button className="btn"><Search size={14} /> Search</button>
        </form>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="split">
        <aside className="list-pane" aria-label="Article list">
          {loading && !data && (
            <div className="skeleton-stack">
              {Array.from({ length: 5 }).map((_, i) => <ListRowSkeleton key={i} />)}
            </div>
          )}
          <ul className="article-list">
            {data?.map((a) => (
              <li key={a.id}>
                <button className={selected?.id === a.id ? "active" : ""} onClick={() => setSelected(a)}>
                  <strong>{a.title}</strong>
                  <span className="muted small">{a.category}</span>
                </button>
              </li>
            ))}
          </ul>
          {data && data.length === 0 && (
            <EmptyState icon={<Search size={20} />} title="No articles match" description="Try a different search term." />
          )}
        </aside>

        <article className="viewer">
          <AnimatePresence mode="wait">
            {selected ? (
              <motion.div key={selected.id} variants={fade} initial="hidden" animate="show" exit="exit">
                <h3>{selected.title}</h3>
                <div className="tags">
                  <span className="badge cat">{selected.category}</span>
                  {selected.tags.map((t) => (
                    <span key={t} className="badge tag">#{t}</span>
                  ))}
                </div>
                <Markdownish body={selected.body} />
              </motion.div>
            ) : (
              <EmptyState icon={<BookOpen size={20} />} title="Select an article" description="Pick one from the list to read it." />
            )}
          </AnimatePresence>
        </article>
      </div>
    </div>
  );
}
