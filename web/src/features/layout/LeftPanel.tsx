import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDndContext, useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TaskList } from '@taskhub/shared';
import { IconButton } from '../../components/Button.js';
import { GripIcon, InboxIcon, ListIcon, PlusIcon, TrashIcon } from '../../components/icons.js';
import { Skeleton } from '../../components/Skeleton.js';
import { dragDataOf, type DragItemData } from '../../lib/dragTypes.js';
import {
  useCreateList,
  useDeleteList,
  useLists,
  useRenameList,
  useSetListColor,
} from '../../lib/queries.js';
import { AccountButton } from '../settings/AccountButton.js';
import { ListColorPicker } from './ListColorPicker.js';
import { listColorVar } from './listColors.js';

export type ListSelection = { kind: 'all' } | { kind: 'ungrouped' } | { kind: 'list'; id: string };

interface LeftPanelProps {
  selection: ListSelection;
  onSelect: (selection: ListSelection) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Mobile drawers close on navigation; the desktop rail does not. */
  onNavigate?: () => void;
  /** Touch: the drag grip cannot wait for a hover that will never come. */
  touch?: boolean;
}

/**
 * The left panel: the user's own lists, plus the two views that always exist.
 *
 * Lists are user-created and named whatever the user likes. That is the
 * grouping level above a main task, and this panel is the whole reason it
 * exists — see ADR-0004.
 *
 * Collapses to a 64px icon rail on desktop, and becomes a slide-over drawer on
 * mobile (see AppShell).
 */
export function LeftPanel({
  selection,
  onSelect,
  collapsed,
  onToggleCollapsed,
  onNavigate,
  touch = false,
}: LeftPanelProps) {
  const { t } = useTranslation();
  const lists = useLists();
  const createList = useCreateList();
  const renameList = useRenameList();
  const deleteList = useDeleteList();
  const setListColor = useSetListColor();

  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const etag = lists.data?.etag ?? '';
  const items = lists.data?.data ?? [];

  const choose = (next: ListSelection): void => {
    onSelect(next);
    onNavigate?.();
  };

  return (
    <nav
      aria-label={t('lists.title')}
      className={`flex h-full flex-col border-r border-border-subtle bg-surface-raised transition-[width] duration-200 ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
        {/* Logo slot. An SVG that reads on both light and dark surfaces goes
            here — see docs/TOKENS.md. */}
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-accent text-xs font-bold text-accent-contrast">
          T
        </span>
        {!collapsed ? (
          <span className="truncate text-sm font-semibold text-content">{t('app.name')}</span>
        ) : null}
        <span className="ml-auto hidden md:block">
          {/* Not "close": it collapses to an icon rail, and a screen reader
              hearing "Stäng" next to every other close control cannot tell
              which one shuts what. */}
          <IconButton
            label={collapsed ? t('a11y.expandPanel') : t('a11y.collapsePanel')}
            onClick={onToggleCollapsed}
          >
            <ListIcon className="h-4 w-4" />
          </IconButton>
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <PanelItem
          icon={<InboxIcon className="h-4 w-4" />}
          label={t('lists.all')}
          active={selection.kind === 'all'}
          collapsed={collapsed}
          onClick={() => choose({ kind: 'all' })}
        />
        <UngroupedRow
          active={selection.kind === 'ungrouped'}
          collapsed={collapsed}
          onClick={() => choose({ kind: 'ungrouped' })}
        />

        {!collapsed ? (
          <div className="mt-4 flex items-center justify-between px-2 pb-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-content-muted">
              {t('lists.title')}
            </span>
            <IconButton label={t('lists.new')} onClick={() => setCreating(true)}>
              <PlusIcon className="h-4 w-4" />
            </IconButton>
          </div>
        ) : null}

        {lists.isLoading ? (
          <div className="space-y-1 px-2 py-1">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-4/5" />
          </div>
        ) : null}

        {/* The DndContext is in DragSurface, above the shell: a task row from
            the list can be dropped on one of these, and that crosses regions. */}
        <>
          <SortableContext
            items={items.map((list) => list.id)}
            strategy={verticalListSortingStrategy}
          >
            {items.map((list) =>
              renamingId === list.id ? (
                <ListNameInput
                  key={list.id}
                  initial={list.name}
                  onCancel={() => setRenamingId(null)}
                  onSubmit={(name) => {
                    renameList.mutate({ id: list.id, name, etag });
                    setRenamingId(null);
                  }}
                />
              ) : (
                <ListRow
                  key={list.id}
                  list={list}
                  collapsed={collapsed}
                  touch={touch}
                  active={selection.kind === 'list' && selection.id === list.id}
                  onClick={() => choose({ kind: 'list', id: list.id })}
                  onRename={() => setRenamingId(list.id)}
                  onDelete={() => deleteList.mutate({ id: list.id, etag })}
                  onSetColor={(colorToken) =>
                    setListColor.mutate({ id: list.id, colorToken, etag })
                  }
                />
              ),
            )}
          </SortableContext>
        </>

        {creating ? (
          <ListNameInput
            initial=""
            onCancel={() => setCreating(false)}
            onSubmit={(name) => {
              // An empty lists blob has no ETag yet; the API treats a missing
              // If-Match as "create" for exactly this first-list case.
              createList.mutate({ name, etag: etag.length > 0 ? etag : null });
              setCreating(false);
            }}
          />
        ) : null}

        {collapsed ? (
          <div className="mt-2 flex justify-center">
            <IconButton label={t('lists.new')} onClick={() => setCreating(true)}>
              <PlusIcon className="h-4 w-4" />
            </IconButton>
          </div>
        ) : null}
      </div>

      <AccountButton collapsed={collapsed} />
    </nav>
  );
}

function PanelItem({
  icon,
  label,
  active,
  collapsed,
  onClick,
  trailing,
  grip,
  gripAlways,
  containerRef,
  style,
  dropTarget,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
  trailing?: React.ReactNode;
  /**
   * A drag handle laid over the row's icon rather than beside it. A 240px panel
   * has no width to spare for a column that is empty most of the time, and the
   * icon is decorative — swapping it for the grip on hover costs nothing and
   * shifts nothing.
   */
  grip?: React.ReactNode;
  /** True on touch, where the grip cannot wait for a hover to reveal it. */
  gripAlways?: boolean;
  containerRef?: (node: HTMLElement | null) => void;
  style?: React.CSSProperties;
  /** A task is hovering over this row and would land in it if released. */
  dropTarget?: boolean;
}) {
  // The two occupy the same 16px box, so exactly one of them may be visible at
  // a time — otherwise a touch device draws the grip on top of the icon.
  const iconVisibility =
    grip === undefined
      ? ''
      : gripAlways === true
        ? 'opacity-0'
        : 'transition-opacity duration-150 group-hover:opacity-0';

  return (
    <div
      ref={containerRef}
      style={style}
      className={`group relative rounded-md ${
        // A ring rather than a fill: the row underneath has to stay readable,
        // because *which* list you are about to drop into is the whole question
        // being asked.
        dropTarget === true ? 'ring-2 ring-accent' : ''
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        title={collapsed ? label : undefined}
        aria-current={active ? 'page' : undefined}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-150 ${
          active
            ? 'bg-surface-selected font-medium text-content'
            : 'text-content-muted hover:bg-surface-hover hover:text-content'
        } ${collapsed ? 'justify-center' : ''}`}
      >
        <span className={`${active ? 'text-accent' : ''} ${iconVisibility}`}>{icon}</span>
        {!collapsed ? <span className="truncate">{label}</span> : null}
      </button>

      {/* Sits on top of the icon it replaces. Outside the button, because a
          button cannot contain another button. */}
      {grip !== undefined ? (
        <span className="absolute left-2 top-1/2 -translate-y-1/2">{grip}</span>
      ) : null}

      {!collapsed && trailing !== undefined ? (
        <span className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
          {trailing}
        </span>
      ) : null}
    </div>
  );
}

function ListRow({
  list,
  collapsed,
  touch,
  active,
  onClick,
  onRename,
  onDelete,
  onSetColor,
}: {
  list: TaskList;
  collapsed: boolean;
  touch: boolean;
  active: boolean;
  onClick: () => void;
  onRename: () => void;
  onDelete: () => void;
  onSetColor: (colorToken: string | null) => void;
}) {
  const { t } = useTranslation();
  const color = listColorVar(list.colorToken);
  const draggedType = useDraggedType();

  /*
    Both a draggable and a drop target.

    Dragging it reorders the panel; dropping a *task* on it moves that task
    into this list. `disabled` only stops the dragging half — the collapsed
    rail has nowhere to put a grip and nothing to say what you picked up, but
    it can still receive a task perfectly well.
  */
  const sortable = useSortable({
    id: list.id,
    disabled: collapsed,
    data: { type: 'list', listId: list.id } satisfies DragItemData,
  });

  return (
    <PanelItem
      icon={
        // Tinted through a wrapper because the icons take a className and
        // nothing else; they draw in `currentColor`, so setting it here is
        // enough. The user's colour outranks the active-item accent — it is
        // what they chose, and how they find this row in a long panel.
        color !== null ? (
          <span style={{ color }}>
            <ListIcon className="h-4 w-4" />
          </span>
        ) : (
          <ListIcon className="h-4 w-4" />
        )
      }
      label={list.name}
      active={active}
      collapsed={collapsed}
      onClick={onClick}
      containerRef={sortable.setNodeRef}
      dropTarget={sortable.isOver && draggedType === 'task'}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        ...(sortable.isDragging ? { opacity: 0.5, zIndex: 10, position: 'relative' } : {}),
      }}
      {...(collapsed
        ? {}
        : {
            gripAlways: touch,
            grip: (
              <button
                type="button"
                ref={sortable.setActivatorNodeRef}
                {...sortable.attributes}
                {...sortable.listeners}
                aria-label={t('dnd.handle', { name: list.name })}
                title={t('dnd.handleShort')}
                className={`flex h-4 w-4 cursor-grab touch-none items-center justify-center rounded text-content-muted transition-opacity duration-150 hover:text-content ${
                  touch
                    ? 'opacity-60'
                    : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100'
                }`}
              >
                <GripIcon className="h-4 w-4" />
              </button>
            ),
          })}
      trailing={
        <span className="flex items-center gap-0.5 bg-surface-raised">
          <ListColorPicker listName={list.name} colorToken={list.colorToken} onPick={onSetColor} />
          <IconButton label={t('lists.rename')} onClick={onRename}>
            <span aria-hidden className="text-xs">
              ✎
            </span>
          </IconButton>
          <IconButton label={t('lists.delete')} onClick={onDelete}>
            <TrashIcon className="h-3.5 w-3.5" />
          </IconButton>
        </span>
      }
    />
  );
}

/**
 * "Ogrupperade" as a drop target.
 *
 * Not a list, so nothing to reorder — but dropping a task here is the only way
 * to take it *out* of a list, which otherwise has no gesture at all.
 */
function UngroupedRow({
  active,
  collapsed,
  onClick,
}: {
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  // Unconditionally, at the top: `isOver && useDraggedType()` would short-
  // circuit the hook away on the renders where nothing is hovering.
  const draggedType = useDraggedType();
  const { setNodeRef, isOver } = useDroppable({
    id: 'taskhub-ungrouped',
    data: { type: 'list', listId: null } satisfies DragItemData,
  });

  return (
    <PanelItem
      icon={<ListIcon className="h-4 w-4" />}
      label={t('lists.ungrouped')}
      active={active}
      collapsed={collapsed}
      onClick={onClick}
      containerRef={setNodeRef}
      dropTarget={isOver && draggedType === 'task'}
    />
  );
}

/** What is currently being dragged, app-wide, or null when nothing is. */
function useDraggedType(): DragItemData['type'] | null {
  const { active } = useDndContext();
  return dragDataOf(active?.data.current)?.type ?? null;
}

function ListNameInput({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initial);

  return (
    <input
      autoFocus
      value={value}
      placeholder={t('lists.namePlaceholder')}
      aria-label={t('lists.new')}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        if (value.trim().length > 0 && value.trim() !== initial) onSubmit(value.trim());
        else onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && value.trim().length > 0) {
          event.preventDefault();
          onSubmit(value.trim());
        } else if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
      className="mt-1 w-full rounded-md border border-accent bg-surface px-2 py-1.5 text-sm text-content outline-none"
    />
  );
}
