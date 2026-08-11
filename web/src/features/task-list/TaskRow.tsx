import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  countChildren,
  isTaskComplete,
  orderedChildren,
  type TaskDocument,
  type TaskNode,
  type TaskSummary,
} from '@taskhub/shared';
import { Checkbox } from '../../components/Checkbox.js';
import { IconButton } from '../../components/Button.js';
import { ChevronRightIcon, PaperclipIcon, PlusIcon } from '../../components/icons.js';
import type { PatchNode } from '../../lib/apiClient.js';
import { InlineDate, InlineText } from './InlineEdit.js';
import { PercentControl } from './PercentControl.js';

export interface RowCallbacks {
  onPatch: (nodeId: string | undefined, patch: PatchNode) => void;
  onAddChild: (title: string) => void;
  onRemoveChild: (childId: string) => void;
  onSelect: () => void;
  onOpenPercentSheet?: (node: TaskNode) => void;
}

interface TaskRowProps extends RowCallbacks {
  summary: TaskSummary;
  document: TaskDocument | undefined;
  expanded: boolean;
  onToggleExpand: () => void;
  selected: boolean;
  gridTemplate: string;
  compact: boolean;
  /** Personal preference: row height. Only meaningful in the desktop grid. */
  rowDensity: 'compact' | 'comfortable';
  /** Personal preference: whether the Kommentarer column is in the list. */
  showComments: boolean;
  /**
   * Personal preference: subtasks expand under their parent (`true`) or live
   * only in the detail pane (`false`). When false the chevron opens the pane —
   * the affordance stays, the destination changes.
   */
  inlineSubtasks: boolean;
  busy?: boolean;
}

/**
 * One main task, and its subtasks inline underneath when expanded.
 *
 * Subtasks are indented under their parent with a left rule, exactly as in the
 * source workbook — not in a modal or a separate panel. That is the single
 * biggest reason the tool should feel familiar on day one.
 */
export function TaskRow({
  summary,
  document,
  expanded,
  onToggleExpand,
  selected,
  gridTemplate,
  compact,
  rowDensity,
  showComments,
  inlineSubtasks,
  busy,
  onPatch,
  onAddChild,
  onRemoveChild,
  onSelect,
  onOpenPercentSheet,
}: TaskRowProps) {
  const { t } = useTranslation();
  const [addingChild, setAddingChild] = useState(false);

  // Density is a padding change, nothing more. Font size and column widths stay
  // put so switching does not reflow the whole table.
  const rowPadding = rowDensity === 'comfortable' ? 'py-3' : 'py-1.5';
  const subtaskPadding = rowDensity === 'comfortable' ? 'py-2.5' : 'py-1';

  // Both entry points into a task's subtasks — the chevron and the + button —
  // go to wherever the user has decided subtasks live.
  const openSubtasks = (): void => {
    if (inlineSubtasks) onToggleExpand();
    else onSelect();
  };
  const addSubtask = (): void => {
    if (!inlineSubtasks) {
      onSelect();
      return;
    }
    if (!expanded) onToggleExpand();
    setAddingChild(true);
  };

  // Prefer the loaded aggregate; fall back to the listing projection. The
  // summary is enough to render a collapsed row, which is what keeps the list
  // view to a single request.
  const root = document?.root;
  const complete = root !== undefined ? isTaskComplete(root) : summary.isComplete;
  const title = root?.title ?? summary.title;
  const date = root?.date ?? summary.date;
  // Falls back to the metadata preview so Kommentarer is populated in the
  // list without opening every blob — it is a primary field (§10).
  const comments = root?.comments ?? summary.commentsPreview;
  const completedDate = root?.completedDate ?? summary.completedDate;

  const childCount = root !== undefined ? countChildren(root).total : summary.childCount;
  const childDone = root !== undefined ? countChildren(root).done : summary.childDoneCount;
  const hasChildren = childCount > 0;

  const children = root !== undefined ? orderedChildren(root) : [];

  /*
    Mobile is a different layout, not a narrower one.

    A seven-column grid cannot fit in 360px — the columns alone exceed it before
    any content — so the row becomes a card: a large checkbox, the title, and a
    single meta line carrying date, progress and attachments. That is what the
    spec means by "no three-column squeeze"; the same reasoning applies to the
    row itself.
  */
  if (compact) {
    return (
      <div
        className={`border-b border-border-subtle ${selected ? 'bg-surface-selected' : ''} ${
          busy === true ? 'opacity-60' : ''
        }`}
      >
        <div className="flex items-start gap-1 px-2 py-1.5">
          <Checkbox
            checked={complete}
            label={t('columns.complete')}
            touchTarget
            onChange={(next) => onPatch(undefined, { isComplete: next })}
          />

          <button type="button" onClick={onSelect} className="min-w-0 flex-1 py-2 text-left">
            <span
              className={`block truncate text-sm font-semibold ${
                complete ? 'text-content-muted line-through' : 'text-content'
              }`}
            >
              {title}
            </span>

            {showComments && comments.length > 0 ? (
              <span className="mt-0.5 block truncate text-xs text-content-muted">{comments}</span>
            ) : null}

            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-content-muted">
              <span className="tabular-nums">{date}</span>
              {root !== undefined || summary.percent > 0 ? (
                <span className="tabular-nums">
                  {complete ? `✓ ${summary.percent}%` : `${summary.percent}%`}
                </span>
              ) : null}
              {hasChildren ? (
                <span className="tabular-nums">
                  {t('task.subtaskProgress', { done: childDone, total: childCount })}
                </span>
              ) : null}
              {summary.attachmentCount > 0 ? (
                <span className="inline-flex items-center gap-0.5">
                  <PaperclipIcon className="h-3 w-3" />
                  {summary.attachmentCount}
                </span>
              ) : null}
            </span>
          </button>

          {hasChildren ? (
            <button
              type="button"
              aria-label={inlineSubtasks ? t('columns.expand') : t('task.openDetails')}
              aria-expanded={inlineSubtasks ? expanded : undefined}
              onClick={openSubtasks}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded text-content-muted"
            >
              <ChevronRightIcon
                className={`h-4 w-4 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
              />
            </button>
          ) : null}
        </div>

        {complete && childCount - childDone > 0 ? (
          <p className="px-2 pb-1.5 pl-14 text-xs text-content-muted">
            {t('task.openSubtasks', { count: childCount - childDone })}
          </p>
        ) : null}

        {expanded ? (
          <div className="pb-1 pl-6">
            {children.map((child) => (
              <div
                key={child.id}
                className="flex items-center gap-1 border-l border-border-subtle pl-2"
              >
                <Checkbox
                  checked={isTaskComplete(child)}
                  label={t('columns.complete')}
                  touchTarget
                  onChange={(next) => onPatch(child.id, { isComplete: next })}
                />
                <span
                  className={`min-w-0 flex-1 truncate text-sm ${
                    isTaskComplete(child) ? 'text-content-muted line-through' : 'text-content'
                  }`}
                >
                  {child.title}
                </span>
              </div>
            ))}

            {addingChild ? (
              <NewSubtaskRow
                compact
                onCancel={() => setAddingChild(false)}
                onCreate={(childTitle) => {
                  onAddChild(childTitle);
                  setAddingChild(false);
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => setAddingChild(true)}
                className="ml-2 h-11 px-2 text-xs text-content-muted"
              >
                + {t('task.newSubtask')}
              </button>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`border-b border-border-subtle transition-colors duration-150 ${
        selected ? 'bg-surface-selected' : 'hover:bg-surface-hover'
      } ${busy === true ? 'opacity-60' : ''}`}
    >
      <div
        className={`group grid items-center gap-x-2 px-2 ${rowPadding}`}
        style={{ gridTemplateColumns: gridTemplate }}
        onClick={onSelect}
        role="row"
      >
        {/* Expand — only on tasks that actually have subtasks. */}
        <div className="flex justify-center">
          {hasChildren ? (
            <button
              type="button"
              aria-label={inlineSubtasks ? t('columns.expand') : t('task.openDetails')}
              aria-expanded={inlineSubtasks ? expanded : undefined}
              onClick={(event) => {
                event.stopPropagation();
                openSubtasks();
              }}
              className="flex h-6 w-6 items-center justify-center rounded text-content-muted hover:bg-surface-hover hover:text-content"
            >
              <ChevronRightIcon
                className={`h-4 w-4 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
              />
            </button>
          ) : null}
        </div>

        {/* Complete — the override that wins over percent. */}
        <div className="flex justify-center" onClick={(event) => event.stopPropagation()}>
          <Checkbox
            checked={complete}
            label={t('columns.complete')}
            touchTarget={compact}
            onChange={(next) => onPatch(undefined, { isComplete: next })}
          />
        </div>

        {/* Datum */}
        <div onClick={(event) => event.stopPropagation()}>
          <InlineDate
            value={date}
            ariaLabel={t('columns.date')}
            onCommit={(next) => {
              if (next !== null) onPatch(undefined, { date: next });
            }}
          />
        </div>

        {/* Uppgift — main tasks render semibold. */}
        <div className="min-w-0" onClick={(event) => event.stopPropagation()}>
          <InlineText
            value={title}
            emphasis
            ariaLabel={t('columns.title')}
            onCommit={(next) => {
              if (next.length > 0) onPatch(undefined, { title: next });
            }}
          />
        </div>

        {/* Kommentarer — a primary field, truncated to one line. Shown unless the
            user has turned the column off in settings. */}
        {!compact && showComments ? (
          <div className="min-w-0" onClick={(event) => event.stopPropagation()}>
            <InlineText
              value={comments}
              ariaLabel={t('columns.comments')}
              disabled={document === undefined}
              className="text-sm text-content-muted"
              onCommit={(next) => onPatch(undefined, { comments: next })}
            />
          </div>
        ) : null}

        {/* Status — percent, main tasks only. */}
        {!compact ? (
          <div onClick={(event) => event.stopPropagation()}>
            {root !== undefined ? (
              <PercentControl
                node={root}
                onChangePercent={(percent) => onPatch(undefined, { percent })}
                onBackToAuto={() => onPatch(undefined, { percentSource: 'derived' })}
                {...(onOpenPercentSheet !== undefined
                  ? { onOpenSheet: () => onOpenPercentSheet(root) }
                  : {})}
              />
            ) : (
              <CollapsedPercent percent={summary.percent} complete={summary.isComplete} />
            )}
          </div>
        ) : null}

        {/* Färdig datum */}
        {!compact ? (
          <div onClick={(event) => event.stopPropagation()}>
            <InlineDate
              value={completedDate}
              subtle
              ariaLabel={t('columns.completedDate')}
              onCommit={(next) => onPatch(undefined, { completedDate: next })}
            />
          </div>
        ) : null}

        {/* Trailing affordances: attachment count, subtask progress, add. */}
        <div className="flex items-center justify-end gap-1.5 text-xs text-content-muted">
          {summary.attachmentCount > 0 ? (
            <span className="flex items-center gap-0.5" title={t('columns.attachments')}>
              <PaperclipIcon className="h-3.5 w-3.5" />
              {summary.attachmentCount}
            </span>
          ) : null}

          {hasChildren ? (
            <span className="tabular-nums" title={t('columns.expand')}>
              {t('task.subtaskProgress', { done: childDone, total: childCount })}
            </span>
          ) : null}

          {/* Most of the row is click-to-edit, so opening the detail pane needs
              an affordance of its own rather than relying on hitting the gaps. */}
          <span className="flex items-center opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
            <IconButton
              label={t('task.newSubtask')}
              onClick={(event) => {
                event.stopPropagation();
                addSubtask();
              }}
            >
              <PlusIcon className="h-4 w-4" />
            </IconButton>
            <IconButton
              label={t('task.openDetails')}
              onClick={(event) => {
                event.stopPropagation();
                onSelect();
              }}
            >
              <ChevronRightIcon className="h-4 w-4" />
            </IconButton>
          </span>
        </div>
      </div>

      {/* A quiet hint, not a block: the parent is done, some children are not. */}
      {complete && childCount - childDone > 0 ? (
        <div className="px-2 pb-1.5 pl-12 text-xs text-content-muted">
          {t('task.openSubtasks', { count: childCount - childDone })}
        </div>
      ) : null}

      {expanded ? (
        <div className="pb-1">
          {children.map((child) => (
            <SubtaskRow
              key={child.id}
              node={child}
              gridTemplate={gridTemplate}
              compact={compact}
              showComments={showComments}
              padding={subtaskPadding}
              onPatch={(patch) => onPatch(child.id, patch)}
              onRemove={() => onRemoveChild(child.id)}
            />
          ))}

          {addingChild ? (
            <NewSubtaskRow
              compact={compact}
              onCancel={() => setAddingChild(false)}
              onCreate={(childTitle) => {
                onAddChild(childTitle);
                setAddingChild(false);
              }}
            />
          ) : null}

          {children.length === 0 && !addingChild ? (
            <button
              type="button"
              onClick={() => setAddingChild(true)}
              className="ml-12 rounded px-2 py-1 text-xs text-content-muted hover:bg-surface-hover hover:text-content"
            >
              + {t('task.newSubtask')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The bar shown before the aggregate is loaded, from listing metadata alone. */
function CollapsedPercent({ percent, complete }: { percent: number; complete: boolean }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <span
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="relative h-1.5 w-full min-w-10 overflow-hidden rounded-full bg-surface-sunken"
      >
        <span
          className={`absolute inset-y-0 left-0 rounded-full ${
            complete ? 'bg-[var(--success-500)]' : 'bg-accent'
          }`}
          style={{ width: `${complete ? 100 : percent}%` }}
        />
      </span>
      <span className="shrink-0 text-xs tabular-nums text-content-muted">
        {complete ? `✓ ${percent}%` : `${percent}%`}
      </span>
    </div>
  );
}

interface SubtaskRowProps {
  node: TaskNode;
  gridTemplate: string;
  compact: boolean;
  showComments: boolean;
  /** Vertical padding class, so a subtask matches its parent's density. */
  padding: string;
  onPatch: (patch: PatchNode) => void;
  onRemove: () => void;
}

/**
 * A subtask: indented under its parent with a left rule connecting them.
 *
 * The Status cell is deliberately empty. A subtask's completion is its
 * checkbox, and the discriminated union in the domain means it has no percent
 * to show even if this wanted to render one.
 */
function SubtaskRow({
  node,
  gridTemplate,
  compact,
  showComments,
  padding,
  onPatch,
  onRemove,
}: SubtaskRowProps) {
  const { t } = useTranslation();
  const complete = isTaskComplete(node);

  return (
    <div
      className={`group grid items-center gap-x-2 px-2 ${padding} hover:bg-surface-hover`}
      style={{ gridTemplateColumns: gridTemplate }}
      role="row"
    >
      <div />

      <div className="flex justify-center">
        <Checkbox
          checked={complete}
          label={t('columns.complete')}
          touchTarget={compact}
          onChange={(next) => onPatch({ isComplete: next })}
        />
      </div>

      <div>
        <InlineDate
          value={node.date}
          ariaLabel={t('columns.date')}
          onCommit={(next) => {
            if (next !== null) onPatch({ date: next });
          }}
        />
      </div>

      {/* The indent and left rule that tie the subtask to its parent. */}
      <div className="ml-6 min-w-0 border-l border-border-subtle pl-3">
        <InlineText
          value={node.title}
          ariaLabel={t('columns.title')}
          className={complete ? 'text-content-muted line-through' : ''}
          onCommit={(next) => {
            if (next.length > 0) onPatch({ title: next });
          }}
        />
      </div>

      {!compact && showComments ? (
        <div className="min-w-0">
          <InlineText
            value={node.comments}
            ariaLabel={t('columns.comments')}
            className="text-sm text-content-muted"
            onCommit={(next) => onPatch({ comments: next })}
          />
        </div>
      ) : null}

      {/* Status: empty for subtasks, by design. */}
      {!compact ? <div /> : null}

      {!compact ? (
        <div>
          <InlineDate
            value={node.completedDate}
            subtle
            ariaLabel={t('columns.completedDate')}
            onCommit={(next) => onPatch({ completedDate: next })}
          />
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-1 text-xs text-content-muted">
        {node.attachments.length > 0 ? (
          <span className="flex items-center gap-0.5">
            <PaperclipIcon className="h-3.5 w-3.5" />
            {node.attachments.length}
          </span>
        ) : null}
        <span className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
          <IconButton label={t('task.delete')} onClick={onRemove}>
            <span aria-hidden>×</span>
          </IconButton>
        </span>
      </div>
    </div>
  );
}

function NewSubtaskRow({
  compact,
  onCreate,
  onCancel,
}: {
  compact: boolean;
  onCreate: (title: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');

  return (
    <div className={`px-2 py-1 ${compact ? 'pl-6' : 'pl-[9.5rem]'}`}>
      <input
        autoFocus
        value={value}
        placeholder={t('task.titlePlaceholder')}
        aria-label={t('task.newSubtask')}
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
        className="w-full max-w-md rounded border border-accent bg-surface px-2 py-1 text-sm text-content outline-none"
      />
    </div>
  );
}
