import type { CSSProperties } from "react";

/** Shimmering placeholder blocks shown while a request is in flight (>0ms — real requests, not decoration). */
export function Skeleton({ width, height = 14, radius = 6, style }: { width?: number | string; height?: number; radius?: number; style?: CSSProperties }) {
  return <span className="skeleton" style={{ display: "block", width: width ?? "100%", height, borderRadius: radius, ...style }} />;
}

export function StatCardSkeleton() {
  return (
    <div className="stat-card" aria-hidden="true">
      <Skeleton width={34} height={34} radius={10} />
      <Skeleton width="60%" height={11} style={{ marginTop: "var(--space-2)" }} />
      <Skeleton width="40%" height={30} />
      <Skeleton width="80%" height={11} />
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="health-card" aria-hidden="true">
      <div className="skeleton-row">
        <Skeleton width={9} height={9} radius={99} />
        <Skeleton width="50%" height={13} />
      </div>
      <Skeleton width="100%" height={48} radius={10} />
    </div>
  );
}

/** Matches the padding of a real `.incident-list`/`.article-list` row so nothing shifts when data replaces it. */
export function ListRowSkeleton() {
  return (
    <div className="skeleton-list-row" aria-hidden="true">
      <Skeleton width="40%" height={10} />
      <Skeleton width="80%" height={13} />
      <Skeleton width="55%" height={10} />
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <table className="table" aria-hidden="true">
      <tbody>
        {Array.from({ length: rows }).map((_, r) => (
          <tr key={r}>
            {Array.from({ length: cols }).map((_, c) => (
              <td key={c}><Skeleton height={12} width={c === 0 ? "70%" : "45%"} /></td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
