import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskNode, TaskSummary } from '@taskhub/shared';
import { Button } from '../../components/Button.js';
import { EmptyState } from '../../components/EmptyState.js';
import { InboxIcon } from '../../components/icons.js';
import { TaskListSkeleton } from '../../components/Skeleton.js';
import type { PatchNode, TaskFilter } from '../../lib/apiClient.js';
import {
  useAddChild,
  useCreateTask,
  usePatchNode,
  useRemoveChild,
  useTask,
  useTasks,
} from '../../lib/queries.js';
import { usePreferences } from '../../lib/preferences.js';
import { COLUMNS, useColumnWidths, type ColumnDefinition } from './columns.js';
import { ConflictBanner } from './ConflictBanner.js';
import { PercentSheet } from './PercentControl.js';
import { TaskRow } from './TaskRow.js';

interface TaskListViewProps {
  filter: TaskFilter;
  /** True below the md breakpoint: fewer columns, larger touch targets. */
  compact: boolean;
  selectedTaskId: string | null;
  onSelectTask: (id: string) => void;
  /** The list a new task is created in. */
  activeListId: string | null;
  /**
   * Increments when something outside asks for a new task — the `n` shortcut,
   * the header button, the mobile action bar. A counter rather than a boolean
   * so repeated requests each register.
   */
  createSignal?: number;
}

/**
 * The spreadsheet, done properly.
 *
 * Dense by default, sticky header, resizable columns — a working list rather
 * than a marketing page. Row separation is a 1px border and nothing more: no
 * heavy grid lines, no yellow input fills, no saturated header band. Those are
 * the details that make it read as an app rather than an exported worksheet.
 */
export function TaskListView({
  filter,
  compact,
  selectedTaskId,
  onSelectTask,
  activeListId,
  createSignal = 0,
}: TaskListViewProps) {
  const { t } = useTranslation();
  const tasks = useTasks(filter);
  const { gridTemplate, setWidth, widthOf } = useColumnWidths();
  const [preferences] = usePreferences();

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (createSignal > 0) setCreating(true);
  }, [createSignal]);
  const [percentSheetFor, setPercentSheetFor] = useState<{ taskId: string; node: TaskNode } | null>(
    null,
  );

  const patch = usePatchNode();
  const createTask = useCreateTask();
  const addChild = useAddChild();
  const removeChild = useRemoveChild();

  /*
    Subtask placement is a personal preference (settings, bottom left).

    `inline` expands them under the parent as the workbook did; `detail` keeps
    the list to one row per task and shows subtasks only in the pane. Neither is
    right for everyone, which is why it is a setting rather than a decision.
  */
  const inlineSubtasks = preferences.subtaskDisplay === 'inline';

  const template = gridTemplate({ compact, hideComments: !preferences.showComments });
  const visibleColumns = useMemo(
    () =>
      COLUMNS.filter(
        (column) =>
          !(compact && column.desktopOnly === true) &&
          !(column.id === 'comments' && !preferences.showComments),
      ),
    [compact, preferences.showComments],
  );

  const toggleExpand = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (tasks.isLoading) return <TaskListSkeleton />;

  if (tasks.isError) {
    return (
      <EmptyState
        title={t('common.error')}
        description={(tasks.error as Error).message}
        action={
          <Button variant="secondary" onClick={() => void tasks.refetch()}>
            {t('common.retry')}
          </Button>
        }
      />
    );
  }

  const summaries = tasks.data ?? [];

  return (
    <div className="flex h-full flex-col">
      {patch.conflict !== null ? (
        <ConflictBanner
          conflict={patch.conflict}
          onDismiss={patch.dismissConflict}
          onApplyMine={patch.forceConflictResolution}
        />
      ) : null}

      {/* Sticky header. Neutral surface, bottom border, muted uppercase labels —
          never the saturated band from the workbook.

          Hidden on mobile, where rows are cards rather than a grid and column
          headings would label nothing. */}
      {/*
        Header and rows share one scroll container so they scroll together
        horizontally. Without this the grid bleeds out of the column when the
        detail pane narrows it, and the header ends up drawn over the pane.

        `min-w` sets the point at which the table starts scrolling sideways
        instead of crushing its columns — a dense table is better scrolled than
        squeezed.
      */}
      <div className="flex-1 overflow-auto">
        <div className={compact ? '' : 'min-w-[820px]'}>
          {!compact ? (
            <div
              className="sticky top-0 z-10 grid gap-x-2 border-b border-border-subtle bg-surface-raised px-2 py-1.5"
              style={{ gridTemplateColumns: template }}
              role="row"
            >
              {visibleColumns.map((column) => (
                <HeaderCell
                  key={column.id}
                  column={column}
                  width={widthOf(column)}
                  onResize={(width) => setWidth(column.id, width)}
                />
              ))}
            </div>
          ) : null}

          {summaries.length === 0 && !creating ? (
            <EmptyState
              icon={<InboxIcon className="h-8 w-8" />}
              title={t('empty.noTasks')}
              action={
                <Button variant="primary" onClick={() => setCreating(true)}>
                  {t('empty.noTasksAction')}
                </Button>
              }
            />
          ) : (
            summaries.map((summary) => (
              <TaskRowContainer
                key={summary.id}
                summary={summary}
                expanded={inlineSubtasks && expanded.has(summary.id)}
                selected={selectedTaskId === summary.id}
                gridTemplate={template}
                compact={compact}
                rowDensity={preferences.rowDensity}
                showComments={preferences.showComments}
                inlineSubtasks={inlineSubtasks}
                onToggleExpand={() => toggleExpand(summary.id)}
                onSelect={() => onSelectTask(summary.id)}
                onPatch={(nodeId, nodePatch, etag) =>
                  patch.mutate({
                    taskId: summary.id,
                    ...(nodeId !== undefined ? { childId: nodeId } : {}),
                    patch: nodePatch,
                    etag,
                  })
                }
                onAddChild={(title, etag) => addChild.mutate({ id: summary.id, etag, title })}
                onRemoveChild={(childId, etag) =>
                  removeChild.mutate({ id: summary.id, childId, etag })
                }
                onOpenPercentSheet={
                  compact ? (node) => setPercentSheetFor({ taskId: summary.id, node }) : undefined
                }
              />
            ))
          )}

          {creating ? (
            <NewTaskRow
              compact={compact}
              gridTemplate={template}
              onCancel={() => setCreating(false)}
              onCreate={(title) => {
                createTask.mutate({ title, listId: activeListId });
                setCreating(false);
              }}
            />
          ) : summaries.length > 0 ? (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="w-full px-4 py-2.5 text-left text-sm text-content-muted hover:bg-surface-hover hover:text-content"
            >
              + {t('task.new')}
            </button>
          ) : null}
        </div>
      </div>

      {percentSheetFor !== null ? (
        <PercentSheetContainer
          taskId={percentSheetFor.taskId}
          node={percentSheetFor.node}
          onClose={() => setPercentSheetFor(null)}
          onChange={(percent, etag) =>
            patch.mutate({ taskId: percentSheetFor.taskId, patch: { percent }, etag })
          }
        />
      ) : null}
    </div>
  );
}

/**
 * Loads the aggregate for a row when it is expanded or selected, and supplies
 * the freshest ETag available to every mutation.
 *
 * A collapsed row never opens its blob — that is the point of the metadata
 * projection. The ETag from the listing is a real blob ETag, so quick actions
 * like ticking the checkbox work without a read first.
 */
function TaskRowContainer({
  summary,
  expanded,
  selected,
  gridTemplate,
  compact,
  onToggleExpand,
  onSelect,
  rowDensity,
  showComments,
  inlineSubtasks,
  onPatch,
  onAddChild,
  onRemoveChild,
  onOpenPercentSheet,
}: {
  summary: TaskSummary;
  expanded: boolean;
  selected: boolean;
  gridTemplate: string;
  compact: boolean;
  onToggleExpand: () => void;
  onSelect: () => void;
  rowDensity: 'compact' | 'comfortable';
  showComments: boolean;
  inlineSubtasks: boolean;
  onPatch: (nodeId: string | undefined, patch: PatchNode, etag: string) => void;
  onAddChild: (title: string, etag: string) => void;
  onRemoveChild: (childId: string, etag: string) => void;
  onOpenPercentSheet?: ((node: TaskNode) => void) | undefined;
}) {
  const needsDocument = expanded || selected;
  const query = useTask(needsDocument ? summary.id : null);

  const etag = query.data?.etag ?? summary.etag ?? '';

  return (
    <TaskRow
      summary={summary}
      document={query.data?.data}
      expanded={expanded}
      selected={selected}
      gridTemplate={gridTemplate}
      compact={compact}
      rowDensity={rowDensity}
      showComments={showComments}
      inlineSubtasks={inlineSubtasks}
      busy={query.isFetching && query.data === undefined}
      onToggleExpand={onToggleExpand}
      onSelect={onSelect}
      onPatch={(nodeId, patch) => onPatch(nodeId, patch, etag)}
      onAddChild={(title) => onAddChild(title, etag)}
      onRemoveChild={(childId) => onRemoveChild(childId, etag)}
      {...(onOpenPercentSheet !== undefined ? { onOpenPercentSheet } : {})}
    />
  );
}

function PercentSheetContainer({
  taskId,
  node,
  onClose,
  onChange,
}: {
  taskId: string;
  node: TaskNode;
  onClose: () => void;
  onChange: (percent: number, etag: string) => void;
}) {
  const query = useTask(taskId);
  const etag = query.data?.etag ?? '';

  return (
    <PercentSheet
      node={node}
      onClose={onClose}
      onChangePercent={(percent) => onChange(percent, etag)}
    />
  );
}

function HeaderCell({
  column,
  width,
  onResize,
}: {
  column: ColumnDefinition;
  width: number;
  onResize: (width: number) => void;
}) {
  const { t } = useTranslation();

  const startResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = width;

    const onMove = (move: PointerEvent): void => {
      onResize(startWidth + (move.clientX - startX));
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div className="relative flex min-w-0 items-center">
      <span className="truncate px-1 text-[11px] font-medium uppercase tracking-wide text-content-muted">
        {column.labelKey !== null ? t(column.labelKey) : ''}
      </span>
      {column.resizable ? (
        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={startResize}
          className="absolute -right-1 top-0 h-full w-2 cursor-col-resize touch-none hover:bg-accent/30"
        />
      ) : null}
    </div>
  );
}

function NewTaskRow({
  compact,
  gridTemplate,
  onCreate,
  onCancel,
}: {
  compact: boolean;
  gridTemplate: string;
  onCreate: (title: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');

  return (
    <div
      className="grid items-center gap-x-2 border-b border-border-subtle px-2 py-1.5"
      style={{ gridTemplateColumns: gridTemplate }}
    >
      <div />
      <div />
      <div />
      <div className={compact ? 'col-span-1' : ''}>
        <input
          autoFocus
          value={value}
          placeholder={t('task.titlePlaceholder')}
          aria-label={t('task.new')}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => {
            if (value.trim().length > 0) onCreate(value.trim());
            else onCancel();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && value.trim().length > 0) {
              event.preventDefault();
              onCreate(value.trim());
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onCancel();
            }
          }}
          className="w-full rounded border border-accent bg-surface px-2 py-1 text-sm font-semibold text-content outline-none"
        />
      </div>
    </div>
  );
}
