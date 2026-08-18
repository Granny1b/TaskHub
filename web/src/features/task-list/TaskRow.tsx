import { useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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
import { ChevronRightIcon, GripIcon, PaperclipIcon, PlusIcon } from '../../components/icons.js';
import type { DragItemData } from '../../lib/dragTypes.js';
import type { PatchNode } from '../../lib/apiClient.js';
import { FIELD, InlineDate, InlineText } from './InlineEdit.js';
import { NewSubtaskInput } from './NewSubtaskInput.js';
import { PercentControl } from './PercentControl.js';
import { SwipeRow } from './SwipeRow.js';

/**
 * Which subtask controls a row shows, given its state.
 *
 * Extracted because the desktop grid and the phone card used to decide this
 * separately and disagreed: the phone offered "+ Ny deluppgift" whenever a row
 * was open, the desktop only while the row had no subtasks at all. So the
 * button people learned on an empty task vanished the moment they used it, and
 * a task that already had subtasks never offered it. One rule now, read by
 * both.
 */
export function subtaskAffordances(state: {
  hasChildren: boolean;
  expanded: boolean;
  addingChild: boolean;
}): { chevron: boolean; addButton: boolean } {
  return {
    /*
      A row with no subtasks has nothing to expand, so it gets no chevron —
      until something expands it anyway, which the + button does. Without the
      second clause that row is stranded: open, empty, and with no control on
      it that closes it again.
    */
    chevron: state.hasChildren || state.expanded,

    /*
      Always at the foot of an open row, exactly like "+ Ny uppgift" at the
      foot of the list. Deliberately not conditioned on the subtasks having
      loaded: `children` is empty until the aggregate arrives, so a count-based
      rule made the button flash in and out as a row opened.
    */
    addButton: state.expanded && !state.addingChild,
  };
}

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

  /** The freshest concurrency token for this task, for subtask drags. */
  etag: string;
  /** Sortable wiring, owned by the container that calls `useSortable`. */
  rowRef: (node: HTMLElement | null) => void;
  rowStyle: CSSProperties;
  dragging: boolean;
  /** The grip, rendered by the container so the row stays free of dnd-kit. */
  dragHandle: ReactNode;
  /**
   * Ask the container to load the full aggregate for this row.
   *
   * Editing Kommentarer needs the whole comment, not the truncated preview the
   * listing carries — see the cell below.
   */
  onRequestDocument: () => void;
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
  etag,
  rowRef,
  rowStyle,
  dragging,
  dragHandle,
  onRequestDocument,
  onPatch,
  onAddChild,
  onRemoveChild,
  onSelect,
  onOpenPercentSheet,
}: TaskRowProps) {
  const { t } = useTranslation();
  const [addingChild, setAddingChild] = useState(false);
  /*
    "Pressing + is what opened this row."

    So that cancelling can put it back. Without this, pressing + on a task with
    no subtasks and then thinking better of it left the row expanded and empty
    — and because a childless row had no chevron, nothing on it could close it
    again short of collapse-all.
  */
  const [openedToAdd, setOpenedToAdd] = useState(false);
  // "The user clicked Kommentarer and is waiting for the full text."
  const [commentsRequested, setCommentsRequested] = useState(false);

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
    if (!expanded) {
      onToggleExpand();
      setOpenedToAdd(true);
    }
    setAddingChild(true);
  };
  const cancelAdd = (): void => {
    setAddingChild(false);
    if (openedToAdd) {
      onToggleExpand();
      setOpenedToAdd(false);
    }
  };
  const commitAdd = (childTitle: string): void => {
    onAddChild(childTitle);
    setAddingChild(false);
    // The row stays open on purpose: there is now a subtask in it to see.
    setOpenedToAdd(false);
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

  const affordances = subtaskAffordances({ hasChildren, expanded, addingChild });

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
        ref={rowRef}
        style={rowStyle}
        className={`group/row border-b border-border-subtle bg-surface ${
          selected ? 'bg-surface-selected' : ''
        } ${busy === true ? 'opacity-60' : ''} ${dragging ? 'z-10 opacity-50 shadow-lg' : ''}`}
      >
        {/*
          Swipe covers the card, not the expanded subtasks underneath it: the
          gesture acts on the main task, so it should not appear to pick up its
          children. Each subtask row swipes on its own.
        */}
        <SwipeRow
          complete={complete}
          enabled={!dragging}
          onToggle={(next) => onPatch(undefined, { isComplete: next })}
        >
          <div className="flex items-start gap-1 px-2 py-1.5">
            <span className="flex items-center">{dragHandle}</span>

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

            {affordances.chevron ? (
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
        </SwipeRow>

        {complete && childCount - childDone > 0 ? (
          <p className="px-2 pb-1.5 pl-14 text-xs text-content-muted">
            {t('task.openSubtasks', { count: childCount - childDone })}
          </p>
        ) : null}

        {expanded ? (
          <div className="pb-1 pl-6">
            <SortableContext
              items={children.map((child) => child.id)}
              strategy={verticalListSortingStrategy}
            >
              {children.map((child) => (
                <CompactSubtaskRow
                  key={child.id}
                  node={child}
                  taskId={summary.id}
                  siblingIds={children.map((sibling) => sibling.id)}
                  etag={etag}
                  onPatch={(patch) => onPatch(child.id, patch)}
                />
              ))}
            </SortableContext>

            {addingChild ? (
              <NewSubtaskInput
                className="px-2 py-1 pl-6"
                onCancel={cancelAdd}
                onCreate={commitAdd}
              />
            ) : null}

            {affordances.addButton ? (
              <button
                type="button"
                onClick={() => setAddingChild(true)}
                className="ml-2 h-11 px-2 text-xs text-content-muted"
              >
                + {t('task.newSubtask')}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      ref={rowRef}
      style={rowStyle}
      className={`group/row border-b border-border-subtle bg-surface transition-colors duration-150 ${
        selected ? 'bg-surface-selected' : 'hover:bg-surface-hover'
      } ${busy === true ? 'opacity-60' : ''} ${dragging ? 'z-10 opacity-50 shadow-lg' : ''}`}
    >
      {/*
        No click handler on the row.

        There used to be one, opening the detail pane, and seven of the nine
        cells cancelled it with `stopPropagation` so they could edit instead.
        What survived was the leftovers: the 8px column gutters, the row's
        horizontal padding, the strip above and below each cell's content. Land
        in one of those and the pane opened; land a pixel over and you were
        typing in a date field. Which you got depended on hitting a gap you
        could not see.

        One rule instead. Every cell is a field you click to edit; the chevron
        at the right-hand end opens the task, and it is always visible so it
        does not have to be guessed at.
      */}
      <div
        className={`group grid items-center gap-x-2 px-2 ${rowPadding}`}
        style={{ gridTemplateColumns: gridTemplate }}
        role="row"
      >
        {/* The grip. Hidden until the row is hovered or it takes focus. */}
        <div className="flex justify-center">{dragHandle}</div>

        {/* Expand — on tasks that have subtasks, and on one that + has opened. */}
        <div className="flex justify-center">
          {affordances.chevron ? (
            <button
              type="button"
              aria-label={inlineSubtasks ? t('columns.expand') : t('task.openDetails')}
              aria-expanded={inlineSubtasks ? expanded : undefined}
              onClick={openSubtasks}
              className="flex h-6 w-6 items-center justify-center rounded text-content-muted hover:bg-surface-hover hover:text-content"
            >
              <ChevronRightIcon
                className={`h-4 w-4 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
              />
            </button>
          ) : null}
        </div>

        {/* Complete — the override that wins over percent. */}
        <div className="flex justify-center">
          <Checkbox
            checked={complete}
            label={t('columns.complete')}
            touchTarget={compact}
            onChange={(next) => onPatch(undefined, { isComplete: next })}
          />
        </div>

        {/* Datum */}
        <div>
          <InlineDate
            value={date}
            ariaLabel={t('columns.date')}
            onCommit={(next) => {
              if (next !== null) onPatch(undefined, { date: next });
            }}
          />
        </div>

        {/* Uppgift — main tasks render semibold. */}
        <div className="min-w-0">
          <InlineText
            value={title}
            emphasis
            ariaLabel={t('columns.title')}
            onCommit={(next) => {
              if (next.length > 0) onPatch(undefined, { title: next });
            }}
          />
        </div>

        {/*
          Kommentarer — editable straight from the row.

          With a caveat that decides the whole shape of this. A collapsed row has
          not opened its blob, so `comments` here is `summary.commentsPreview`,
          which is cut at COMMENTS_PREVIEW_LENGTH. Editing that and saving would
          silently delete everything past the cut.

          So clicking asks for the document, shows the preview meanwhile, and the
          real editor mounts — already focused — the moment the full text lands.
          One extra GET the first time, and no way to truncate a comment by
          typing in a cell.
        */}
        {!compact && showComments ? (
          <div className="min-w-0">
            {document !== undefined ? (
              <InlineText
                value={comments}
                autoEdit={commentsRequested}
                ariaLabel={t('columns.comments')}
                placeholder={t('task.commentsPlaceholder')}
                className="text-sm text-content-muted"
                onCommit={(next) => {
                  setCommentsRequested(false);
                  onPatch(undefined, { comments: next });
                }}
              />
            ) : (
              <button
                type="button"
                aria-label={t('columns.comments')}
                title={comments.length > 0 ? comments : t('task.commentsPlaceholder')}
                onClick={() => {
                  setCommentsRequested(true);
                  onRequestDocument();
                }}
                className={`${FIELD} text-sm ${
                  commentsRequested ? 'animate-pulse' : ''
                } ${comments.length > 0 ? 'text-content-muted' : 'text-content-muted/60'}`}
              >
                {comments.length > 0 ? comments : t('task.commentsPlaceholder')}
              </button>
            )}
          </div>
        ) : null}

        {/* Status — percent, main tasks only. */}
        {!compact ? (
          <div>
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
          <div>
            <InlineDate
              value={completedDate}
              subtle
              ariaLabel={t('columns.completedDate')}
              onCommit={(next) => onPatch(undefined, { completedDate: next })}
            />
          </div>
        ) : null}

        {/*
          Trailing affordances: attachment count, subtask progress, add, open.

          Pinned to the right edge of the horizontal scroll.

          The table is wider than its column when the detail pane is open on a
          1400px screen — measured at 179px of overflow — and the chevron below
          is the only way to open a task. Left unpinned it scrolled out of sight
          in exactly the state where you most want it: pane open, wanting the
          next task. An explicit background because a sticky cell has to be
          opaque, and the row's own colour lives on an ancestor.
        */}
        <div
          className={`sticky right-0 z-[1] flex items-center justify-end gap-1.5 pl-2 text-xs text-content-muted ${
            selected ? 'bg-surface-selected' : 'bg-surface group-hover/row:bg-surface-hover'
          }`}
        >
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

          {/* Adding a subtask is a second thought about a row you are already
              working in, so it stays on hover. */}
          <span className="flex items-center opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
            <IconButton label={t('task.newSubtask')} onClick={addSubtask}>
              <PlusIcon className="h-4 w-4" />
            </IconButton>
          </span>

          {/*
            Always visible, unlike everything else in this cell.

            It is the only thing that opens a task now that the row itself does
            not, so hiding it until hover would make the one deliberate way in
            the one you have to discover by accident. It sits at the end of the
            row, pointing the way the pane opens.
          */}
          <IconButton label={t('task.openDetails')} onClick={onSelect}>
            <ChevronRightIcon className="h-4 w-4" />
          </IconButton>
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
          <SortableContext
            items={children.map((child) => child.id)}
            strategy={verticalListSortingStrategy}
          >
            {children.map((child) => (
              <SubtaskRow
                key={child.id}
                node={child}
                taskId={summary.id}
                siblingIds={children.map((sibling) => sibling.id)}
                etag={etag}
                gridTemplate={gridTemplate}
                compact={compact}
                showComments={showComments}
                padding={subtaskPadding}
                onPatch={(patch) => onPatch(child.id, patch)}
                onRemove={() => onRemoveChild(child.id)}
              />
            ))}
          </SortableContext>

          {addingChild ? (
            <NewSubtaskInput
              className="px-2 py-1 pl-[9.5rem]"
              onCancel={cancelAdd}
              onCreate={commitAdd}
            />
          ) : null}

          {affordances.addButton ? (
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

/**
 * A subtask on a phone: checkbox, title, grip. No columns, because there is no
 * room for them — the same reasoning that turns the whole row into a card.
 */
function CompactSubtaskRow({
  node,
  taskId,
  siblingIds,
  etag,
  onPatch,
}: {
  node: TaskNode;
  taskId: string;
  siblingIds: string[];
  etag: string;
  onPatch: (patch: PatchNode) => void;
}) {
  const { t } = useTranslation();
  const complete = isTaskComplete(node);
  const sortable = useSortable({
    id: node.id,
    data: { type: 'child', taskId, siblingIds, etag } satisfies DragItemData,
  });

  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
      className={`border-l border-border-subtle bg-surface ${
        sortable.isDragging ? 'z-10 opacity-50 shadow-lg' : ''
      }`}
    >
      <SwipeRow
        complete={complete}
        enabled={!sortable.isDragging}
        onToggle={(next) => onPatch({ isComplete: next })}
      >
        <div className="flex items-center gap-1 pl-2">
          <button
            type="button"
            ref={sortable.setActivatorNodeRef}
            {...sortable.attributes}
            {...sortable.listeners}
            aria-label={t('dnd.handle', { name: node.title })}
            className="flex h-11 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-content-muted opacity-60"
          >
            <GripIcon className="h-4 w-4" />
          </button>

          <Checkbox
            checked={complete}
            label={t('columns.complete')}
            touchTarget
            onChange={(next) => onPatch({ isComplete: next })}
          />

          <span
            className={`min-w-0 flex-1 truncate text-sm ${
              complete ? 'text-content-muted line-through' : 'text-content'
            }`}
          >
            {node.title}
          </span>
        </div>
      </SwipeRow>
    </div>
  );
}

interface SubtaskRowProps {
  node: TaskNode;
  /** Its parent task, and the siblings it is ordered among — both for drags. */
  taskId: string;
  siblingIds: string[];
  etag: string;
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
  taskId,
  siblingIds,
  etag,
  gridTemplate,
  compact,
  showComments,
  padding,
  onPatch,
  onRemove,
}: SubtaskRowProps) {
  const { t } = useTranslation();
  const complete = isTaskComplete(node);

  // Subtasks are ordered inside their parent's document, so a drag here is one
  // write to one blob — unlike a main-task move (ADR-0034).
  const sortable = useSortable({
    id: node.id,
    data: { type: 'child', taskId, siblingIds, etag } satisfies DragItemData,
  });

  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        gridTemplateColumns: gridTemplate,
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
      className={`group/row grid items-center gap-x-2 bg-surface px-2 ${padding} hover:bg-surface-hover ${
        sortable.isDragging ? 'z-10 opacity-50 shadow-lg' : ''
      }`}
      role="row"
    >
      <div className="flex justify-center">
        <button
          type="button"
          ref={sortable.setActivatorNodeRef}
          {...sortable.attributes}
          {...sortable.listeners}
          aria-label={t('dnd.handle', { name: node.title })}
          title={t('dnd.handleShort')}
          className="flex h-6 w-5 cursor-grab touch-none items-center justify-center rounded text-content-muted opacity-0 transition-opacity duration-150 hover:bg-surface-hover hover:text-content focus-visible:opacity-100 group-hover/row:opacity-100"
        >
          <GripIcon className="h-4 w-4" />
        </button>
      </div>

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
          {/* The placeholder is what a main task's cell has always had, and it
              is the difference between an empty cell you can see and click and
              one that renders as nothing at all. */}
          <InlineText
            value={node.comments}
            ariaLabel={t('columns.comments')}
            placeholder={t('task.commentsPlaceholder')}
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

      {/* Pinned like the main row's, for the same reason. `bg-inherit` works
          here because a subtask row carries its own background, so the cell
          tracks the row through hover without a second rule that could get out
          of step with it. */}
      <div className="sticky right-0 z-[1] flex items-center justify-end gap-1 bg-inherit pl-2 text-xs text-content-muted">
        {node.attachments.length > 0 ? (
          <span className="flex items-center gap-0.5">
            <PaperclipIcon className="h-3.5 w-3.5" />
            {node.attachments.length}
          </span>
        ) : null}
        {/* `group-hover/row`, not `group-hover`: the nearest group here is this
            row, and it is a *named* one. Plain `group-hover` looks for an
            unnamed `.group` ancestor, of which a subtask has none — so this
            button stayed at opacity 0 however you hovered it, and the only way
            to delete a subtask was the detail pane. */}
        <span className="opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 focus-within:opacity-100">
          <IconButton label={t('task.delete')} onClick={onRemove}>
            <span aria-hidden>×</span>
          </IconButton>
        </span>
      </div>
    </div>
  );
}
