import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PersonIcon } from '../../components/icons.js';
import { useMe } from '../../lib/queries.js';
import { SettingsDialog } from './SettingsDialog.js';

interface AccountButtonProps {
  /** In the collapsed icon rail, only the avatar shows. */
  collapsed: boolean;
}

/**
 * The account button, bottom-left.
 *
 * Where people expect to find "who am I and how do I change things", and the
 * single entry point for personal settings — appearance, language, and how the
 * list is laid out. Replaces the raw switcher rows that used to sit here: those
 * were two controls competing for attention in a corner nobody looks at until
 * they want exactly this.
 */
export function AccountButton({ collapsed }: AccountButtonProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const me = useMe();

  const label = me.data?.userDetails ?? t('settings.title');
  const initial = (me.data?.userDetails ?? '?').trim().charAt(0).toUpperCase();

  return (
    <>
      <div className="shrink-0 border-t border-border-subtle p-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={collapsed ? label : undefined}
          // Collapsed, the avatar is aria-hidden and the label is not rendered,
          // so the button would otherwise have no accessible name at all.
          aria-label={collapsed ? t('settings.open') : undefined}
          aria-haspopup="dialog"
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-150 hover:bg-surface-hover ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          <span
            aria-hidden
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-[11px] font-medium text-content-muted"
          >
            {me.data !== undefined ? initial : <PersonIcon className="h-3.5 w-3.5" />}
          </span>

          {!collapsed ? (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs text-content">{label}</span>
              <span className="block text-[11px] text-content-muted">{t('settings.title')}</span>
            </span>
          ) : null}
        </button>
      </div>

      {open ? <SettingsDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}
