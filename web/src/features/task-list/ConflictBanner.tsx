import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button.js';
import type { PendingConflict } from '../../lib/conflict.js';

interface ConflictBannerProps {
  conflict: PendingConflict;
  onDismiss: () => void;
  onApplyMine: () => void;
}

/**
 * Shown when a write lost a race *and* the two edits touched the same fields.
 *
 * Deliberately non-destructive. The user's attempted change is still held in
 * memory and named here, and the fresh version is already on screen behind the
 * banner, so they can compare before deciding. Nothing is discarded until they
 * pick — the one thing §7 is emphatic about.
 *
 * Disjoint edits never reach this: those are retried silently against the newer
 * ETag, because interrupting someone to tell them their colleague renamed a
 * different subtask would be noise.
 */
export function ConflictBanner({ conflict, onDismiss, onApplyMine }: ConflictBannerProps) {
  const { t } = useTranslation();

  const fieldLabels: Record<string, string> = {
    title: t('columns.title'),
    date: t('columns.date'),
    comments: t('columns.comments'),
    isComplete: t('columns.complete'),
    percent: t('columns.status'),
    percentSource: t('columns.status'),
    completedDate: t('columns.completedDate'),
  };

  const fields = conflict.collidingFields
    .map((field) => fieldLabels[field] ?? field)
    .filter((label, index, all) => all.indexOf(label) === index);

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 border-b border-[var(--warning-500)] bg-[color-mix(in_srgb,var(--warning-500)_12%,var(--surface))] px-4 py-2.5"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-content">{t('conflict.banner')}</p>
        {fields.length > 0 ? (
          <p className="mt-0.5 text-xs text-content-muted">{fields.join(', ')}</p>
        ) : null}
      </div>

      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="secondary" onClick={onDismiss}>
          {t('conflict.reload')}
        </Button>
        <Button size="sm" variant="primary" onClick={onApplyMine}>
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}
