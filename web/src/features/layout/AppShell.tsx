import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { IconButton } from '../../components/Button.js';
import { CollapseIcon, MenuIcon, PlusIcon, SearchIcon } from '../../components/icons.js';
import type { TaskFilter } from '../../lib/apiClient.js';
import { useIsDesktop } from '../../lib/useMediaQuery.js';
import { useKeyboardShortcuts } from '../../lib/useKeyboardShortcuts.js';
import { useFocusTrap } from '../../lib/useFocusTrap.js';
import { useWindowDropGuard } from '../attachments/DropZone.js';
/*
  The detail pane — and with it the whole attachment pipeline — is never on
  screen at first paint. Loading it lazily keeps the initial bundle to what the
  task list actually needs.
*/
const TaskDetailPane = lazy(() =>
  import('../task-detail/TaskDetailPane.js').then((module) => ({
    default: module.TaskDetailPane,
  })),
);
import { TaskListView } from '../task-list/TaskListView.js';
import { DragSurface } from './DragSurface.js';
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
  const [collapseNonce, setCollapseNonce] = useState(0);
  // Lives here rather than in the list because the button that acts on it does.
  const [expandedCount, setExpandedCount] = useState(0);

  const searchRef = useRef<HTMLInputElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
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
  useFocusTrap(drawerRef, drawerOpen, () => setDrawerOpen(false));

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
        <Suspense fallback={<DetailFallback />}>
          <TaskDetailPane taskId={selectedTaskId} onClose={closeTask} asRoute />
        </Suspense>
      </div>
    );
  }

  return (
    /*
      One drag surface over the whole shell.

      It has to sit above both the panel and the list, because a task row is
      picked up in one and dropped on the other, and dnd-kit cannot drag between
      separate contexts. What a drop means lives in DragSurface; the regions
      below only say what is draggable and what can receive.
    */
    <DragSurface filter={filter}>
      <div className="flex h-dvh overflow-hidden bg-surface">
        {/* Visible only on focus. Without it, reaching the task list by keyboard
          means tabbing through every list in the panel first. */}
        <a
          href="#task-list"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:text-accent-contrast"
        >
          {t('a11y.skipToContent')}
        </a>

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
          <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
            <button
              type="button"
              aria-label={t('common.close')}
              className="absolute inset-0 bg-black/40"
              onClick={() => setDrawerOpen(false)}
            />
            <div ref={drawerRef} className="relative h-full w-72 max-w-[85vw] shadow-lg">
              <LeftPanel
                selection={selection}
                onSelect={setSelection}
                collapsed={false}
                touch
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

            {/* Only when there is something to collapse. A button that visibly
              does nothing teaches people to stop trusting the toolbar. */}
            {expandedCount > 0 ? (
              <IconButton
                label={t('task.collapseAll', { count: expandedCount })}
                onClick={() => setCollapseNonce((value) => value + 1)}
              >
                <CollapseIcon className="h-4 w-4" />
              </IconButton>
            ) : null}

            <span className="hidden md:inline-flex">
              <IconButton label={t('task.new')} onClick={() => setNewTaskNonce((v) => v + 1)}>
                <PlusIcon className="h-4 w-4" />
              </IconButton>
            </span>
          </header>

          <main id="task-list" tabIndex={-1} className="min-h-0 flex-1">
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
              collapseSignal={collapseNonce}
              onExpandedCountChange={setExpandedCount}
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
            <Suspense fallback={<DetailFallback />}>
              <TaskDetailPane taskId={selectedTaskId} onClose={closeTask} />
            </Suspense>
          </div>
        ) : null}
      </div>
    </DragSurface>
  );
}

/** Matches the pane's own loading state, so the swap is not a visible jump. */
function DetailFallback() {
  return (
    <div className="h-full w-full border-l border-border-subtle bg-surface p-4">
      <div className="h-6 w-2/3 animate-pulse rounded bg-surface-sunken" />
      <div className="mt-3 h-4 w-1/3 animate-pulse rounded bg-surface-sunken" />
    </div>
  );
}
