import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskList } from '@taskhub/shared';
import { IconButton } from '../../components/Button.js';
import { InboxIcon, ListIcon, PlusIcon, TrashIcon } from '../../components/icons.js';
import { Skeleton } from '../../components/Skeleton.js';
import { useCreateList, useDeleteList, useLists, useRenameList } from '../../lib/queries.js';
import { setLanguage } from '../../i18n/index.js';

export type ListSelection = { kind: 'all' } | { kind: 'ungrouped' } | { kind: 'list'; id: string };

interface LeftPanelProps {
  selection: ListSelection;
  onSelect: (selection: ListSelection) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Mobile drawers close on navigation; the desktop rail does not. */
  onNavigate?: () => void;
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
}: LeftPanelProps) {
  const { t } = useTranslation();
  const lists = useLists();
  const createList = useCreateList();
  const renameList = useRenameList();
  const deleteList = useDeleteList();

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
          <IconButton
            label={collapsed ? t('lists.title') : t('common.close')}
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
        <PanelItem
          icon={<ListIcon className="h-4 w-4" />}
          label={t('lists.ungrouped')}
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
              active={selection.kind === 'list' && selection.id === list.id}
              onClick={() => choose({ kind: 'list', id: list.id })}
              onRename={() => setRenamingId(list.id)}
              onDelete={() => deleteList.mutate({ id: list.id, etag })}
            />
          ),
        )}

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

      {!collapsed ? <LanguageSwitcher /> : null}
    </nav>
  );
}

/**
 * Swedish is the default and English is a deliberate choice, so the switcher
 * lives quietly at the bottom of the panel rather than in a prominent position.
 */
function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current = i18n.language.startsWith('en') ? 'en' : 'sv';

  return (
    <div className="shrink-0 border-t border-border-subtle p-2">
      <div className="flex gap-1" role="group" aria-label="Language">
        {(['sv', 'en'] as const).map((language) => (
          <button
            key={language}
            type="button"
            aria-pressed={current === language}
            onClick={() => setLanguage(language)}
            className={`flex-1 rounded px-2 py-1 text-xs uppercase transition-colors duration-150 ${
              current === language
                ? 'bg-surface-selected font-medium text-content'
                : 'text-content-muted hover:bg-surface-hover'
            }`}
          >
            {language}
          </button>
        ))}
      </div>
    </div>
  );
}

function PanelItem({
  icon,
  label,
  active,
  collapsed,
  onClick,
  trailing,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="group relative">
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
        <span className={active ? 'text-accent' : ''}>{icon}</span>
        {!collapsed ? <span className="truncate">{label}</span> : null}
      </button>
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
  active,
  onClick,
  onRename,
  onDelete,
}: {
  list: TaskList;
  collapsed: boolean;
  active: boolean;
  onClick: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();

  return (
    <PanelItem
      icon={<ListIcon className="h-4 w-4" />}
      label={list.name}
      active={active}
      collapsed={collapsed}
      onClick={onClick}
      trailing={
        <span className="flex items-center gap-0.5 bg-surface-raised">
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
