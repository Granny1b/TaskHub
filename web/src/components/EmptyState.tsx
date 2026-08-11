import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  /** An empty state without an action is a dead end. */
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {icon !== undefined ? <div className="mb-3 text-content-muted">{icon}</div> : null}
      <p className="text-sm font-medium text-content">{title}</p>
      {description !== undefined ? (
        <p className="mt-1 max-w-sm text-sm text-content-muted">{description}</p>
      ) : null}
      {action !== undefined ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
