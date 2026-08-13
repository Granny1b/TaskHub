import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../components/Button.js';
import { CloseIcon } from '../../components/icons.js';
import { setLanguage, SUPPORTED_LANGUAGES } from '../../i18n/index.js';
import { useFocusTrap } from '../../lib/useFocusTrap.js';
import { usePreferences, type ImageQuality, type SubtaskDisplay } from '../../lib/preferences.js';
import { useTheme, type ThemePreference } from '../../lib/theme.js';
import { useMe } from '../../lib/queries.js';

interface SettingsDialogProps {
  onClose: () => void;
}

/**
 * Personal settings.
 *
 * Everything here is per-person and per-device: how someone likes to see their
 * work, not a fact about the work. Nothing in this dialog writes to a task.
 */
export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const { t, i18n } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [preferences, updatePreferences] = usePreferences();
  const { preference: theme, setPreference: setTheme } = useTheme();
  const me = useMe();

  useFocusTrap(dialogRef, true, onClose);

  const currentLanguage = i18n.language.startsWith('en') ? 'en' : 'sv';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('settings.title')}
    >
      <button
        type="button"
        aria-label={t('common.close')}
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />

      <div
        ref={dialogRef}
        className="relative max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-lg border border-border-subtle bg-surface shadow-lg"
      >
        <header className="sticky top-0 flex items-center gap-2 border-b border-border-subtle bg-surface px-4 py-3">
          <h2 className="flex-1 text-sm font-semibold text-content">{t('settings.title')}</h2>
          <IconButton label={t('common.close')} onClick={onClose}>
            <CloseIcon className="h-4 w-4" />
          </IconButton>
        </header>

        <div className="space-y-6 p-4">
          {/* Who you are. Read-only: identity comes from Entra, not from here. */}
          <section>
            <SectionTitle>{t('settings.account')}</SectionTitle>
            <p className="text-sm text-content">{me.data?.userDetails ?? t('common.loading')}</p>
            {me.data !== undefined ? (
              <p className="mt-0.5 text-xs text-content-muted">{me.data.roles.join(', ')}</p>
            ) : null}
          </section>

          {/*
            The setting the list actually changes shape for. Described in terms
            of what the user sees, not in terms of components.
          */}
          <section>
            <SectionTitle>{t('settings.subtasks.title')}</SectionTitle>
            <Choice<SubtaskDisplay>
              name="subtaskDisplay"
              value={preferences.subtaskDisplay}
              onChange={(subtaskDisplay) => updatePreferences({ subtaskDisplay })}
              options={[
                {
                  value: 'inline',
                  label: t('settings.subtasks.inline'),
                  description: t('settings.subtasks.inlineHint'),
                },
                {
                  value: 'detail',
                  label: t('settings.subtasks.detail'),
                  description: t('settings.subtasks.detailHint'),
                },
              ]}
            />
          </section>

          <section>
            <SectionTitle>{t('settings.list.title')}</SectionTitle>

            <label className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-sm text-content">{t('settings.list.showComments')}</span>
              <input
                type="checkbox"
                checked={preferences.showComments}
                onChange={(event) => updatePreferences({ showComments: event.target.checked })}
                className="h-4 w-4 accent-[var(--accent)]"
              />
            </label>

            <div className="mt-2">
              <span className="mb-1 block text-xs text-content-muted">
                {t('settings.list.density')}
              </span>
              <Segmented
                value={preferences.rowDensity}
                onChange={(rowDensity) => updatePreferences({ rowDensity })}
                options={[
                  { value: 'compact' as const, label: t('settings.list.compact') },
                  { value: 'comfortable' as const, label: t('settings.list.comfortable') },
                ]}
              />
            </div>
          </section>

          {/*
            Compression is on by default and changes people's files, so it is
            stated plainly and can be turned off. Someone photographing a
            measurement rather than a machine may want every pixel.
          */}
          <section>
            <SectionTitle>{t('settings.images.title')}</SectionTitle>
            <Choice<ImageQuality>
              name="imageQuality"
              value={preferences.imageQuality}
              onChange={(imageQuality) => updatePreferences({ imageQuality })}
              options={[
                {
                  value: 'balanced',
                  label: t('settings.images.balanced'),
                  description: t('settings.images.balancedHint'),
                },
                {
                  value: 'original',
                  label: t('settings.images.original'),
                  description: t('settings.images.originalHint'),
                },
              ]}
            />
          </section>

          <section>
            <SectionTitle>{t('theme.label')}</SectionTitle>
            <Segmented
              value={theme}
              onChange={(next: ThemePreference) => setTheme(next)}
              options={[
                { value: 'system' as const, label: t('theme.system') },
                { value: 'light' as const, label: t('theme.light') },
                { value: 'dark' as const, label: t('theme.dark') },
              ]}
            />
          </section>

          <section>
            <SectionTitle>{t('settings.language')}</SectionTitle>
            <Segmented
              value={currentLanguage}
              onChange={(next) => setLanguage(next)}
              options={SUPPORTED_LANGUAGES.map((language) => ({
                value: language,
                label: language === 'sv' ? 'Svenska' : 'English',
              }))}
            />
          </section>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-content-muted">
      {children}
    </h3>
  );
}

/** Radio group rendered as cards, so each option can explain itself. */
function Choice<T extends string>({
  name,
  value,
  onChange,
  options,
}: {
  name: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; description: string }[];
}) {
  return (
    <div role="radiogroup" className="space-y-2">
      {options.map((option) => (
        <label
          key={option.value}
          className={`flex cursor-pointer gap-3 rounded-md border p-3 transition-colors duration-150 ${
            value === option.value
              ? 'border-accent bg-surface-selected'
              : 'border-border-subtle hover:bg-surface-hover'
          }`}
        >
          <input
            type="radio"
            name={name}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-content">{option.label}</span>
            <span className="mt-0.5 block text-xs text-content-muted">{option.description}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
}) {
  return (
    <div className="flex gap-1" role="group">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`flex-1 rounded-md border px-2 py-1.5 text-xs transition-colors duration-150 ${
            value === option.value
              ? 'border-accent bg-surface-selected font-medium text-content'
              : 'border-border-subtle text-content-muted hover:bg-surface-hover'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
