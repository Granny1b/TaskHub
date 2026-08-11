import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { IconButton } from '../../components/Button.js';
import { MenuIcon, PlusIcon, SearchIcon } from '../../components/icons.js';
import type { TaskFilter } from '../../lib/apiClient.js';
import { useIsDesktop } from '../../lib/useMediaQuery.js';
import { useKeyboardShortcuts } from '../../lib/useKeyboardShortcuts.js';
import { useWindowDropGuard } from '../attachments/DropZone.js';
import { TaskDetailPane } from '../task-detail/TaskDetailPane.js';
import { TaskListView } from '../task-list/TaskListView.js';
import { LeftPanel, type ListSelection } from './LeftPanel.js';

/**
 * The application shell.
 *
 * Desktop is three regions: panel, list, detail. Mobile is not a squeezed
 * version of that — the panel becomes a slide-over drawer and the detail
 * becomes its own route with a back affordance, which is push navigation as
 * people expect on a phone (§10).
 *
 * The breakpoint is therefore a React value, not only a CSS query: the two
 * layouts render different trees.
 */
export function AppShell() {
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const params = useParams<{ taskId?: string }>();

  const [selection, setSelection] = useState<ListSelection>({ kind: 'all' });
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [newTaskNonce, setNewTaskNonce] = useState(0);

  const searchRef = useRef<HTMLInputElement>(null);
  const selectedTaskId = params.taskId ?? null;

  const openTask = useCallback(
    (id: string) => {
      navigate(`/tasks/${id}`);
    },
    [navigate],
  );

  const closeTask = useCallback(() => {
    navigate('/');
  }, [navigate]);

  // A file dropped outside a drop zone must do nothing, not navigate away and
  // discard what the user was doing.
  useWindowDropGuard();

  useKeyboardShortcuts({
    onSearch: () => searchRef.current?.focus(),
    onNewTask: () => setNewTaskNonce((value) => value + 1),
    onEscape: () => {
      if (drawerOpen) setDrawerOpen(false);
      else if (selectedTaskId !== null) closeTask();
    },
  });

  // The drawer must not survive a layout change; a desktop window with an open
  // mobile drawer is a stuck overlay.
  useEffect(() => {
    if (isDesktop) setDrawerOpen(false);
  }, [isDesktop]);

  const filter: TaskFilter = {
    ...(selection.kind === 'list' ? { listId: selection.id } : {}),
    ...(selection.kind === 'ungrouped' ? { listId: null } : {}),
    ...(search.length > 0 ? { q: search } : {}),
  };

  const activeListId = selection.kind === 'list' ? selection.id : null;

  /* ---------------------------------------------------------------------- */
  /* Mobile: detail is a route of its own                                    */
  /* ---------------------------------------------------------------------- */
  if (!isDesktop && selectedTaskId !== null) {
    return (
      <div className="flex h-dvh flex-col bg-surface">
        <TaskDetailPane taskId={selectedTaskId} onClose={closeTask} asRoute />
      </div>
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-surface">
      {/* Desktop panel */}
      <div className="hidden md:block">
        <LeftPanel
          selection={selection}
          onSelect={setSelection}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((value) => !value)}
        />
      </div>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label={t('common.close')}
            className="absolute inset-0 bg-black/40"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="relative h-full w-72 max-w-[85vw] shadow-lg">
            <LeftPanel
              selection={selection}
              onSelect={setSelection}
              collapsed={false}
              onToggleCollapsed={() => setDrawerOpen(false)}
              onNavigate={() => setDrawerOpen(false)}
            />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border-subtle px-2 md:px-3">
          <span className="md:hidden">
            <IconButton label={t('lists.title')} onClick={() => setDrawerOpen(true)} touchTarget>
              <MenuIcon className="h-5 w-5" />
            </IconButton>
          </span>

          <h1 className="truncate text-sm font-semibold text-content">
            {selection.kind === 'all' ? t('lists.all') : null}
            {selection.kind === 'ungrouped' ? t('lists.ungrouped') : null}
            {selection.kind === 'list' ? t('lists.title') : null}
          </h1>

          <div className="relative ml-auto flex items-center">
            <SearchIcon className="pointer-events-none absolute left-2 h-4 w-4 text-content-muted" />
            <input
              ref={searchRef}
              type="search"
              value={search}
              placeholder={t('filters.search')}
              aria-label={t('filters.search')}
              onChange={(event) => setSearch(event.target.value)}
              className="h-8 w-32 rounded-md border border-border-subtle bg-surface pl-7 pr-2 text-sm text-content outline-none focus:border-accent sm:w-48"
            />
          </div>

          <span className="hidden md:inline-flex">
            <IconButton label={t('task.new')} onClick={() => setNewTaskNonce((v) => v + 1)}>
              <PlusIcon className="h-4 w-4" />
            </IconButton>
          </span>
        </header>

        <main className="min-h-0 flex-1">
          {/* Keyed by selection so switching lists resets row expansion, but
              NOT by the create signal — remounting on every "new task" would
              collapse everything the user had open. */}
          <TaskListView
            key={`${selection.kind}-${selection.kind === 'list' ? selection.id : ''}`}
            filter={filter}
            compact={!isDesktop}
            selectedTaskId={selectedTaskId}
            onSelectTask={openTask}
            activeListId={activeListId}
            createSignal={newTaskNonce}
          />
        </main>

        {/* Bottom action bar: the primary action within thumb reach. */}
        <div className="shrink-0 border-t border-border-subtle p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] md:hidden">
          <button
            type="button"
            onClick={() => setNewTaskNonce((value) => value + 1)}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-accent text-sm font-medium text-accent-contrast"
          >
            <PlusIcon className="h-4 w-4" />
            {t('task.new')}
          </button>
        </div>
      </div>

      {/* Desktop detail pane */}
      {isDesktop && selectedTaskId !== null ? (
        <div className="hidden w-[380px] shrink-0 md:block lg:w-[440px]">
          <TaskDetailPane taskId={selectedTaskId} onClose={closeTask} />
        </div>
      ) : null}
    </div>
  );
}
