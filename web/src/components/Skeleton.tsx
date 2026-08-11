/**
 * Skeleton loaders rather than spinners.
 *
 * A spinner says "something is happening"; a skeleton says "this is what is
 * arriving, and roughly how much of it". For a dense list the second is far
 * less jarring, because the layout does not jump when the data lands.
 *
 * The pulse honours `prefers-reduced-motion` through the global rule in
 * index.css, so it stops animating rather than needing a separate variant.
 */

export function Skeleton({
  className = '',
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`animate-pulse rounded bg-surface-sunken ${className}`}
      style={style}
      aria-hidden
    />
  );
}

export function TaskListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border-subtle" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-3 py-2.5">
          <Skeleton className="h-[18px] w-[18px] rounded-[4px]" />
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3.5 flex-1" style={{ maxWidth: `${40 + ((index * 13) % 30)}%` }} />
          <Skeleton className="h-3.5 w-24" />
        </div>
      ))}
      <span className="sr-only">Laddar…</span>
    </div>
  );
}
