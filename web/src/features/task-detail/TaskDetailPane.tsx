import { useTranslation } from 'react-i18next';
import { countChildren, isTaskComplete, orderedChildren, type TaskNode } from '@taskhub/shared';
import { Button, IconButton } from '../../components/Button.js';
import { Checkbox } from '../../components/Checkbox.js';
import { CloseIcon, PaperclipIcon, PlusIcon } from '../../components/icons.js';
import { Skeleton } from '../../components/Skeleton.js';
import { InlineDate, InlineText } from '../task-list/InlineEdit.js';
import { PercentControl } from '../task-list/PercentControl.js';
import { useAddChild, useDeleteTask, usePatchNode, useTask } from '../../lib/queries.js';

interface TaskDetailPaneProps {
  taskId: string;
  onClose: () => void;
  /** Mobile renders this as a route, not a pane; the header changes. */
  asRoute?: boolean;
}

/**
 * The detail pane: the whole task, with room to write.
 *
 * Kommentarer gets a real multi-line editor here, which is the difference
 * between a field that is technically present and one people actually use. The
 * list still shows it truncated — it is a primary field in the current
 * workflow and must not be hidden away in here.
 */
export function TaskDetailPane({ taskId, onClose, asRoute }: TaskDetailPaneProps) {
  const { t } = useTranslation();
  const query = useTask(taskId);
  const patch = usePatchNode();
  const addChild = useAddChild();
  const deleteTask = useDeleteTask();

  if (query.isLoading) {
    return (
      <aside className="flex h-full w-full flex-col border-l border-border-subtle bg-surface p-4">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="mt-3 h-4 w-1/3" />
        <Skeleton className="mt-6 h-20 w-full" />
      </aside>
    );
  }

  if (query.isError || query.data === undefined) {
    return (
      <aside className="flex h-full w-full flex-col border-l border-border-subtle bg-surface p-4">
        <p className="text-sm text-content-muted">{t('common.error')}</p>
        <Button className="mt-3" onClick={onClose}>
          {t('common.close')}
        </Button>
      </aside>
    );
  }

  const { data: document, etag } = query.data;
  const root = document.root;
  const { total, done } = countChildren(root);
  const children = orderedChildren(root);

  const patchNode = (
    nodeId: string | undefined,
    fields: Parameters<typeof patch.mutate>[0]['patch'],
  ) =>
    patch.mutate({
      taskId,
      ...(nodeId !== undefined ? { childId: nodeId } : {}),
      patch: fields,
      etag,
    });

  return (
    <aside
      className={`flex h-full w-full flex-col bg-surface ${asRoute === true ? '' : 'border-l border-border-subtle'}`}
      aria-label={root.title}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
        <Checkbox
          checked={isTaskComplete(root)}
          label={t('columns.complete')}
          onChange={(next) => patchNode(undefined, { isComplete: next })}
        />
        <span className="flex-1 truncate text-sm font-medium text-content">{root.title}</span>
        <IconButton label={t('common.close')} onClick={onClose} touchTarget={asRoute === true}>
          <CloseIcon className="h-4 w-4" />
        </IconButton>
      </header>

      <div className="flex-1 overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <Field label={t('columns.title')}>
          <InlineText
            value={root.title}
            emphasis
            ariaLabel={t('columns.title')}
            onCommit={(next) => {
              if (next.length > 0) patchNode(undefined, { title: next });
            }}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('columns.date')}>
            <InlineDate
              value={root.date}
              ariaLabel={t('columns.date')}
              onCommit={(next) => {
                if (next !== null) patchNode(undefined, { date: next });
              }}
            />
          </Field>
          <Field label={t('columns.completedDate')}>
            <InlineDate
              value={root.completedDate}
              subtle
              ariaLabel={t('columns.completedDate')}
              onCommit={(next) => patchNode(undefined, { completedDate: next })}
            />
          </Field>
        </div>

        <Field label={t('columns.status')}>
          <PercentControl
            node={root}
            onChangePercent={(percent) => patchNode(undefined, { percent })}
            onBackToAuto={() => patchNode(undefined, { percentSource: 'derived' })}
          />
        </Field>

        <Field label={t('columns.comments')}>
          <InlineText
            value={root.comments}
            multiline
            placeholder={t('task.commentsPlaceholder')}
            ariaLabel={t('columns.comments')}
            onCommit={(next) => patchNode(undefined, { comments: next })}
          />
        </Field>

        <section className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[11px] font-medium uppercase tracking-wide text-content-muted">
              {t('task.subtasks')}
              {total > 0 ? (
                <span className="ml-2 tabular-nums">
                  {t('task.subtaskProgress', { done, total })}
                </span>
              ) : null}
            </h2>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const title = window.prompt(t('task.titlePlaceholder') ?? '');
                if (title !== null && title.trim().length > 0) {
                  addChild.mutate({ id: taskId, etag, title: title.trim() });
                }
              }}
            >
              <PlusIcon className="h-4 w-4" />
              {t('task.newSubtask')}
            </Button>
          </div>

          {children.length === 0 ? (
            <p className="text-sm text-content-muted">{t('empty.noResults')}</p>
          ) : (
            <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
              {children.map((child) => (
                <li key={child.id} className="flex items-center gap-2 px-2 py-1.5">
                  <Checkbox
                    checked={isTaskComplete(child)}
                    label={t('columns.complete')}
                    onChange={(next) => patchNode(child.id, { isComplete: next })}
                  />
                  <span
                    className={`flex-1 truncate text-sm ${
                      isTaskComplete(child) ? 'text-content-muted line-through' : 'text-content'
                    }`}
                  >
                    {child.title}
                  </span>
                  <SubtaskAttachments node={child} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-6">
          <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-content-muted">
            {t('columns.attachments')}
          </h2>
          {/* Phase 5 replaces this with the drop zone, grid and camera capture. */}
          <p className="rounded-md border border-dashed border-border-strong px-3 py-6 text-center text-sm text-content-muted">
            {t('attachments.add')} — Phase 5
          </p>
        </section>

        <div className="mt-8 border-t border-border-subtle pt-4">
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              deleteTask.mutate({ id: taskId, etag });
              onClose();
            }}
          >
            {t('task.delete')}
          </Button>
        </div>
      </div>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-content-muted">
        {label}
      </span>
      {children}
    </div>
  );
}

function SubtaskAttachments({ node }: { node: TaskNode }) {
  if (node.attachments.length === 0) return null;
  return (
    <span className="flex items-center gap-0.5 text-xs text-content-muted">
      <PaperclipIcon className="h-3.5 w-3.5" />
      {node.attachments.length}
    </span>
  );
}
