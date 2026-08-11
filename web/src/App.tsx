import { useTranslation } from 'react-i18next';
import { MAX_TASK_DEPTH, completionKindForDepth, enabledViews } from '@taskhub/shared';

/**
 * Phase 0 shell.
 *
 * This is scaffolding, not the product: it renders enough to prove the token
 * layer, the i18n wiring and the shared-package import all work end to end.
 * The real three-region layout is Phase 4 (§10) and replaces this entirely.
 */
export function App(): React.JSX.Element {
  const { t, i18n } = useTranslation();

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-content">{t('app.name')}</h1>
      <p className="mt-1 text-sm text-content-muted">{t('app.tagline')}</p>

      <div className="mt-8 rounded-lg border border-border-subtle bg-surface-raised p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-content-muted">
          Phase 0 scaffold
        </h2>
        <dl className="mt-3 space-y-1 text-sm text-content">
          <div className="flex gap-2">
            <dt className="text-content-muted">Language:</dt>
            <dd>{i18n.language}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-content-muted">Max task depth:</dt>
            <dd>{MAX_TASK_DEPTH}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-content-muted">Completion at depth 0 / 1:</dt>
            <dd>
              {completionKindForDepth(0)} / {completionKindForDepth(1)}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-content-muted">Enabled views:</dt>
            <dd>
              {enabledViews()
                .map((view) => t(view.labelKey))
                .join(', ')}
            </dd>
          </div>
        </dl>
      </div>

      <p className="mt-6 text-sm text-content-muted">
        The task list, detail pane and left panel arrive in Phase 4.
      </p>
    </main>
  );
}
