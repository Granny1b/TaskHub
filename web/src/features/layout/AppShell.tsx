import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { IconButton } from '../../components/Button.js';
import { CheckIcon, CollapseIcon, MenuIcon, PlusIcon, SearchIcon } from '../../components/icons.js';
import type { TaskFilter } from '../../lib/apiClient.js';
import { searchShortcutLabel } from '../../lib/shortcutLabel.js';
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
import { FilesView } from '../files/FilesView.js';
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
  /**
   * Whether finished work stays in the list.
   *
   * Defaults to showing everything, which is what the workbook did — hiding
   * rows on day one would look like data loss to someone migrating.
   */
  const [showCompleted, setShowCompleted] = useState(true);
  const [newTaskNonce, setNewTaskNonce] = useState(0);
  const [collapseNonce, setCollapseNonce] = useState(0);
  // Lives here rather than in the list because the button that acts on it does.
  const [expandedCount, setExpandedCount] = useState(0);

  const searchRef = useRef<HTMLInputElement>(null);
  // Read once: the platform does not change while the app is open.
  const shortcutLabel = useMemo(() => searchShortcutLabel(), []);
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

  const searching = search.length > 0;

  /*
    Searching always looks everywhere.

    "Hide completed" is a way of tidying the working list, not a statement that
    finished work is uninteresting — and the single most common reason to search
    is to find something you already did. A search that silently skipped
    completed tasks would answer "no results" to a question that has one, which
    is the worst possible failure for a search box. So the completion filter is
    dropped for the duration of a query.
  */
  const filter: TaskFilter = {
    ...(selection.kind === 'list' ? { listId: selection.id } : {}),
    ...(selection.kind === 'ungrouped' ? { listId: null } : {}),
    ...(search.length > 0 ? { q: search } : {}),
    ...(!showCompleted && !searching ? { isComplete: false } : {}),
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
              {selection.kind === 'files' ? t('files.title') : null}
            </h1>

            {/* Hide or show finished work. Not shown in the files view, which
              has no notion of completion. */}
            {selection.kind !== 'files' ? (
              <button
                type="button"
                aria-pressed={!showCompleted}
                onClick={() => setShowCompleted((value) => !value)}
                title={showCompleted ? t('filters.hideCompleted') : t('filters.showCompleted')}
                className={`ml-auto hidden h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors duration-150 sm:inline-flex ${
                  showCompleted
                    ? 'border-border-subtle text-content-muted hover:bg-surface-hover'
                    : 'border-accent bg-surface-selected font-medium text-content'
                }`}
              >
                <CheckIcon className="h-3.5 w-3.5" />
                {showCompleted ? t('filters.hideCompleted') : t('filters.showCompleted')}
              </button>
            ) : null}

            {/*
              One search field for the whole app, whatever section you are in.

              The files view used to carry a second one inside its own toolbar
              while this one kept sitting up here doing nothing — two boxes on
              screen, one of them dead, and `Ctrl K` landing in the dead one.
              Now this is the only one, and the placeholder says what it will
              search.
            */}
            <div
              className={`relative flex items-center ${selection.kind === 'files' ? 'ml-auto' : 'ml-2'}`}
            >
              <SearchIcon className="pointer-events-none absolute left-2 h-4 w-4 text-content-muted" />
              <input
                ref={searchRef}
                type="search"
                value={search}
                placeholder={selection.kind === 'files' ? t('files.search') : t('filters.search')}
                aria-label={selection.kind === 'files' ? t('files.search') : t('filters.search')}
                onChange={(event) => setSearch(event.target.value)}
                className="h-8 w-32 rounded-md border border-border-subtle bg-surface pl-7 pr-12 text-sm text-content outline-none focus:border-accent sm:w-56"
              />
              {/*
                The shortcut, shown where the shortcut is for.

                `aria-hidden` because it is a hint about a key, not a control and
                not part of the field's name — a screen reader announcing
                "Sök Ctrl K" would be reading decoration as label. It hides once
                there is text, where it would otherwise sit on top of it.
              */}
              {search.length === 0 ? (
                <kbd
                  aria-hidden
                  className="pointer-events-none absolute right-2 hidden rounded border border-border-subtle bg-surface-sunken px-1 py-0.5 font-sans text-[10px] leading-none text-content-muted sm:block"
                >
                  {shortcutLabel}
                </kbd>
              ) : null}
            </div>

            {/*
              Collapse all — phones only.

              The table header carries this control in the column the chevrons
              are in, which is where a tree view puts it and where the eye looks
              for it. That header only exists from `md` up, so this is the
              fallback for the card layout below it rather than a second copy
              beside the search field.

              Still conditional on something being expanded: a button that
              visibly does nothing teaches people to stop trusting the toolbar.
            */}
            {expandedCount > 0 ? (
              <span className="md:hidden">
                <IconButton
                  label={t('task.collapseAll', { count: expandedCount })}
                  onClick={() => setCollapseNonce((value) => value + 1)}
                >
                  <CollapseIcon className="h-4 w-4" />
                </IconButton>
              </span>
            ) : null}

            {/*
              No "new task" button up here.

              It did nothing at all in the files view, where the list that
              consumes the signal is not mounted — and everywhere else it was a
              third way to do something already offered twice on screen: the
              "+ Ny uppgift" row at the foot of the list, the empty state's own
              button when there is no list yet, and the `n` shortcut. The place
              a task gets created is the end of the list it goes into.

              The phone keeps its bottom action bar: on a touch screen the foot
              of a long list is not within reach, which is what that bar is for.
            */}
          </header>

          <main id="task-list" tabIndex={-1} className="min-h-0 flex-1">
            {/* Keyed by selection so switching lists resets row expansion, but
              NOT by the create signal — remounting on every "new task" would
              collapse everything the user had open. */}
            {selection.kind === 'files' ? (
              <FilesView compact={!isDesktop} search={search} onOpenTask={openTask} />
            ) : (
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
            )}
          </main>

          {/* Bottom action bar: the primary action within thumb reach.

              Not in the files view, where it was the same dead button as the
              one that used to be in the header — the list it signals is not
              mounted there. Files arrive by being attached to a task, so there
              is no create action to offer on this screen. */}
          {selection.kind !== 'files' ? (
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
          ) : null}
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
