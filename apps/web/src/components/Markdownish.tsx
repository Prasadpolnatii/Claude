import { Fragment, type ReactNode } from "react";

/**
 * Minimal, dependency-free Markdown-ish renderer for knowledge articles:
 * supports `#`/`##`/`###` headings, `- ` / `* ` bullet lists, `1.` ordered
 * lists, blank-line paragraphs, and inline `**bold**` + `` `code` ``. Anything
 * fancier (tables, images) renders as plain text — intentional: the corpus is
 * runbook prose, and a real renderer would be an avoidable dependency here.
 */

function inline(text: string, keyBase: string): ReactNode[] {
  // Split on **bold** and `code`, keeping delimiters.
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={`${keyBase}-${i}`}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={`${keyBase}-${i}`}>{p.slice(1, -1)}</code>;
    return <Fragment key={`${keyBase}-${i}`}>{p}</Fragment>;
  });
}

export function Markdownish({ body }: { body: string }) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];

  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it, `li-${blocks.length}`)}</li>);
    blocks.push(list.ordered ? <ol key={`b${blocks.length}`}>{items}</ol> : <ul key={`b${blocks.length}`}>{items}</ul>);
    list = null;
  };
  const flushPara = () => {
    if (!para.length) return;
    blocks.push(<p key={`b${blocks.length}`}>{inline(para.join(" "), `p-${blocks.length}`)}</p>);
    para = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const ordered = /^\d+\.\s+(.*)$/.exec(line);

    if (heading) {
      flushPara();
      flushList();
      const level = heading[1]!.length;
      const text = heading[2]!;
      const key = `b${blocks.length}`;
      blocks.push(level === 1 ? <h2 key={key}>{text}</h2> : level === 2 ? <h3 key={key}>{text}</h3> : <h4 key={key}>{text}</h4>);
    } else if (bullet) {
      flushPara();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]!);
    } else if (ordered) {
      flushPara();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ordered[1]!);
    } else if (line.trim() === "") {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();

  return <div className="md">{blocks}</div>;
}
