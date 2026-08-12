# TOKENS.md — the design token layer, and how to swap it for FinalInspection's

Spec reference: §10 (Frontend / The left panel / Modig branding).

The spec says the left panel and overall look should match the user's existing **FinalInspection**
app, and that the tokens should be extracted from that repo. **FinalInspection is not available in
this environment** — no path was supplied and nothing matching it is present on disk. Per spec §10
step 4 ("if the repo isn't available, build against a neutral token set and leave a `TOKENS.md`
documenting exactly which values to swap"), this file is that document.

Everything below is a **placeholder**. It is designed to be defensible on its own — it is a
coherent, accessible, dense-UI token set that the app can be built and shipped against — but every
value in the "Placeholder" column is expected to be replaced once FinalInspection can be read.

---

## 1. Where tokens live

> **Superseded in one respect — read this first (see ADR-0009).** This document was written
> against the spec's assumption of Tailwind v3, where `tokens.css` had to be _mirrored_ into a
> `tailwind.config.ts`. The project ships **Tailwind v4**, which configures itself from CSS. There
> is no `tailwind.config.ts` and no mirror to keep in sync — which serves this document's own goal
> better, since a token is now defined in exactly one place.
>
> Also note the naming: where this document writes `--color-accent-500`, the implemented token is
> `--accent-500`. The `--color-` prefix is what the `@theme inline` block in `index.css` adds when
> exposing a token to Tailwind as a utility. **`tokens.css` is authoritative for names.**
> Everything else below — the ramps, the contrast analysis, and the swap procedure — applies as
> written.

| File                         | Role                                                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `/web/src/styles/tokens.css` | **The single source of truth.** Every token is a CSS custom property declared here                                                           |
| `/web/src/styles/index.css`  | **Exposure only.** The `@theme inline` block maps tokens to Tailwind utility names — `--color-accent: var(--accent)` — and restates no value |

That rule is the whole point: Tailwind gets the ergonomic class names
(`bg-surface`, `text-content-muted`, `rounded-lg`), but the values resolve at runtime from CSS, so
a theme swap is an edit to one file and touches no components. `inline` matters — it makes the
utility resolve the custom property at use time, so a token redefined under a dark selector changes
the utility with it. If a hex literal ever appears outside `tokens.css`, the layer has been broken.

**Both light and dark values exist from day one**, as spec §10 requires ("full dark mode via the
token layer from day one — retrofitting it is miserable"). The mechanism:

- The **raw ramps** (neutral 50–950, accent 50–950, semantics) are declared once on `:root` and
  **never change between themes**. A colour called `--color-neutral-800` is the same colour in
  both themes.
- The **semantic aliases** (`--surface`, `--text-primary`, `--border`, …) are what flip. They are
  declared on `:root` for light and redeclared under the dark selector, each pointing at a
  different step of the same ramp.
- Components only ever reference semantic aliases, never raw ramp steps. `text-[var(--text-muted)]`
  is correct; `text-neutral-500` in a component is a bug, because it will be wrong in one theme.

Dark mode uses Tailwind's `class` strategy (`darkMode: ['class', '[data-theme="dark"]']`) so the
theme can be forced per-user rather than only following `prefers-color-scheme`.

> Note on current state: `/web` currently exists only as a workspace package — there is no
> `/web/src`, no `tokens.css` and no `tailwind.config.ts` yet (the app shell lands in Phase 4).
> This file is the specification those files are written _from_, not a description of files that
> already exist.

---

## 2. The token tables

### 2.1 Neutral ramp

Carries almost the entire UI: surfaces, borders, text, table chrome. A slate-tinted neutral is
used rather than a pure grey, because it sits better beside a cyan-blue accent.

| Token                 | Placeholder | Typical use                                               | Replace with               |
| --------------------- | ----------- | --------------------------------------------------------- | -------------------------- |
| `--color-neutral-50`  | `#F8FAFC`   | App background (light)                                    | FinalInspection neutral 50 |
| `--color-neutral-100` | `#F1F5F9`   | Table header surface, hover fill                          | ” 100                      |
| `--color-neutral-200` | `#E2E8F0`   | Row separators, default border                            | ” 200                      |
| `--color-neutral-300` | `#CBD5E1`   | Stronger border, disabled control edge                    | ” 300                      |
| `--color-neutral-400` | `#94A3B8`   | Placeholder text, disabled text, icons (dark)             | ” 400                      |
| `--color-neutral-500` | `#64748B`   | Muted text on light — **contrast floor, 4.76:1 on white** | ” 500                      |
| `--color-neutral-600` | `#475569`   | Secondary text on light (7.58:1)                          | ” 600                      |
| `--color-neutral-700` | `#334155`   | Icon default (light)                                      | ” 700                      |
| `--color-neutral-800` | `#1E293B`   | Raised surface (dark), sidebar (dark)                     | ” 800                      |
| `--color-neutral-900` | `#0F172A`   | Primary text on light (17.85:1); app background (dark)    | ” 900                      |
| `--color-neutral-950` | `#020617`   | Deepest surface (dark), scrim base                        | ” 950                      |

### 2.2 Brand / accent ramp

Anchored on the Modig brand blue at step 500. See §3 — **this ramp is the most important thing to
replace, and the anchor hex must come from FinalInspection, not from this file.**

| Token                | Placeholder   | Typical use                                                                           | Replace with             |
| -------------------- | ------------- | ------------------------------------------------------------------------------------- | ------------------------ |
| `--color-accent-50`  | `#EAF7FD`     | Selected-row tint (light), subtle accent fill                                         | FinalInspection brand 50 |
| `--color-accent-100` | `#CDEDFA`     | Active nav background (light)                                                         | ” 100                    |
| `--color-accent-200` | `#A3DEF6`     | Accent border, chart fill                                                             | ” 200                    |
| `--color-accent-300` | `#6FCBF0`     | Accent text/icon on **dark** surfaces                                                 | ” 300                    |
| `--color-accent-400` | `#46BAEA`     | Accent text, links, focus ring on **dark** (8.05:1 on neutral-900)                    | ” 400                    |
| `--color-accent-500` | **`#29ABE2`** | **The brand blue.** Logo, brand marks, large flat areas. _Not_ safe for text on light | ” brand anchor           |
| `--color-accent-600` | `#1B8ABB`     | Hover state of a primary button; borders (3.89:1 on white — non-text only)            | ” 600                    |
| `--color-accent-700` | `#166D95`     | **Primary button fill, links, focus ring on light** (5.74:1 on white)                 | ” 700                    |
| `--color-accent-800` | `#145974`     | Pressed state                                                                         | ” 800                    |
| `--color-accent-900` | `#144A5F`     | Accent text on very light accent tints                                                | ” 900                    |
| `--color-accent-950` | `#0D2F3E`     | Reserved                                                                              | ” 950                    |

If FinalInspection ships only a single brand hex and no ramp, generate the ramp from its anchor
rather than keeping these placeholder steps — a ramp mixed from a different anchor will look
subtly wrong against the real brand colour.

### 2.3 Semantic colours

| Token                  | Placeholder (light) | Placeholder (dark) | Use                                                                         | Replace with            |
| ---------------------- | ------------------- | ------------------ | --------------------------------------------------------------------------- | ----------------------- |
| `--color-success`      | `#16A34A`           | `#22C55E`          | Completed progress bar fill, done state. **Non-text only on light: 3.30:1** | FinalInspection success |
| `--color-success-text` | `#15803D`           | `#4ADE80`          | "Complete" as text/icon (5.02:1 on white)                                   | ” success, darker step  |
| `--color-warning`      | `#D97706`           | `#F59E0B`          | Overdue marker, non-text (3.19:1)                                           | ” warning               |
| `--color-warning-text` | `#B45309`           | `#FBBF24`          | Warning text (5.02:1 on white)                                              | ” warning, darker step  |
| `--color-danger`       | `#DC2626`           | `#EF4444`          | Destructive action, validation error (4.83:1 on white — text-safe)          | ” danger                |
| `--color-info`         | `#2563EB`           | `#60A5FA`          | Informational banner, the ETag conflict notice (5.17:1)                     | ” info                  |

### List colours

Seven hues a user can pin to their own lists, plus "no colour". Chosen for being
distinguishable from each other rather than for meaning anything, and stored on
the list as a **token name** (`blue`), never a hex — so a re-skin is an edit to
`tokens.css` and no data migrates.

| Token           | Light     | Dark      |
| --------------- | --------- | --------- |
| `--list-blue`   | `#2563EB` | `#60A5FA` |
| `--list-green`  | `#15803D` | `#4ADE80` |
| `--list-teal`   | `#0F766E` | `#2DD4BF` |
| `--list-amber`  | `#B45309` | `#FBBF24` |
| `--list-red`    | `#DC2626` | `#F87171` |
| `--list-purple` | `#7E22CE` | `#C084FC` |
| `--list-pink`   | `#BE185D` | `#F472B6` |

These tint a 16px icon and a 24px swatch — no text sits on them. Colour is never
the only cue either: the list name is always beside it (WCAG 1.4.1). The light
values are the darker step of each hue for the same reason as the status
colours; the dark values are lifted, because the light set goes muddy on a dark
surface.

Note the split into `-text` variants for success and warning: at the standard 600 step both fail
4.5:1 as text on white. Keeping one token for the fill and one for the label avoids the very
common bug of a green "Complete" label that no one over 45 can read.

**The rule cuts both ways, and that is easier to forget.** The same 3.30:1 and 3.19:1 apply to
white text drawn _on_ those fills — contrast is symmetric. The swipe-to-complete band on mobile is
a filled panel with a word in it, so it uses the darker step (`--success-600` / `--warning-600` in
`tokens.css`, the same values as the `-text` variants above) and measures 5.02:1. Any future
filled badge, toast or banner carrying text is in the same position: reach for 600, not 500.

### 2.4 Semantic surface and text aliases

**This is the layer components use.** Light and dark both defined from day one.

| Token                | Light                | Dark                 | Use                                                                                     |
| -------------------- | -------------------- | -------------------- | --------------------------------------------------------------------------------------- |
| `--surface-base`     | `neutral-50`         | `neutral-900`        | App background                                                                          |
| `--surface-raised`   | `#FFFFFF`            | `neutral-800`        | Cards, detail pane, task rows                                                           |
| `--surface-sunken`   | `neutral-100`        | `neutral-950`        | Table header, left panel                                                                |
| `--surface-hover`    | `neutral-100`        | `neutral-800`        | Row hover                                                                               |
| `--surface-selected` | `accent-50`          | `accent-950`         | Selected task row                                                                       |
| `--border-subtle`    | `neutral-200`        | `neutral-800`        | The 1px row separator (spec §10: "row separation is a 1px subtle border, nothing more") |
| `--border-default`   | `neutral-300`        | `neutral-700`        | Inputs, buttons                                                                         |
| `--border-focus`     | `accent-700`         | `accent-400`         | Focus ring                                                                              |
| `--text-primary`     | `neutral-900`        | `neutral-100`        | Task titles, body                                                                       |
| `--text-secondary`   | `neutral-600`        | `neutral-400`        | Kommentarer, metadata                                                                   |
| `--text-muted`       | `neutral-500`        | `neutral-400`        | Table header labels, placeholders                                                       |
| `--text-on-accent`   | `#FFFFFF`            | `#FFFFFF`            | Label on a filled accent-700 button                                                     |
| `--scrim`            | `rgb(2 6 23 / 0.40)` | `rgb(2 6 23 / 0.60)` | Behind the mobile drawer and bottom sheet                                               |

### 2.5 Spacing — 8px grid

Spec §10 mandates an 8px grid. A single 4px half-step is kept for dense-table work (icon gaps,
badge padding); nothing smaller exists.

| Token          | Placeholder | Use                                                      | Replace with               |
| -------------- | ----------- | -------------------------------------------------------- | -------------------------- |
| `--space-0`    | `0`         | —                                                        | —                          |
| `--space-half` | `4px`       | Icon-to-label gap, badge padding. The only sub-grid step | FinalInspection equivalent |
| `--space-1`    | `8px`       | Compact row padding, inline gaps                         | ”                          |
| `--space-2`    | `16px`      | Standard control padding, cell padding                   | ”                          |
| `--space-3`    | `24px`      | Section gaps, subtask indent (spec §10: ~24px)           | ”                          |
| `--space-4`    | `32px`      | Panel padding                                            | ”                          |
| `--space-5`    | `40px`      | —                                                        | ”                          |
| `--space-6`    | `48px`      | Large section separation                                 | ”                          |
| `--space-8`    | `64px`      | Empty-state vertical rhythm                              | ”                          |
| `--space-10`   | `80px`      | Page-level top/bottom                                    | ”                          |

Fixed dimensions that are _not_ spacing tokens but are referenced by the layout, listed here so
they are not hardcoded either: `--panel-width: 240px`, `--panel-width-collapsed: 64px`
(spec §10), `--row-height-compact: 36px`, `--touch-target-min: 44px` (spec §10, mobile).

### 2.6 Radii

| Token           | Placeholder | Use                                    | Replace with       |
| --------------- | ----------- | -------------------------------------- | ------------------ |
| `--radius-none` | `0`         | Table cells                            | —                  |
| `--radius-sm`   | `4px`       | Badges, checkbox, small chips          | FinalInspection sm |
| `--radius-md`   | `6px`       | Inputs, buttons                        | ” md               |
| `--radius-lg`   | `8px`       | Cards, dropdowns, detail pane sections | ” lg               |
| `--radius-xl`   | `12px`      | Modals, mobile bottom sheet            | ” xl               |
| `--radius-full` | `9999px`    | Avatars, pills, the percent bar        | ” full             |

Radius is one of the strongest carriers of "brand feel" and is very likely to differ in
FinalInspection. Check it early — a 2px vs 8px difference reads as a different product.

### 2.7 Type scale

Dense working list, not a marketing page (spec §10). The scale is deliberately tight at the bottom.

| Token                    | Placeholder size / line-height                                            | Use                                                                                    | Replace with                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `--font-sans`            | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` | Everything                                                                             | FinalInspection font stack — **check whether it ships a webfont**; if so, self-host it, do not add a Google Fonts request |
| `--font-mono`            | `ui-monospace, "Cascadia Mono", Consolas, monospace`                      | IDs, diagnostics                                                                       | ”                                                                                                                         |
| `--text-xs`              | `12px / 16px`                                                             | Badges, attachment counts, table header labels                                         | ” xs                                                                                                                      |
| `--text-sm`              | `14px / 20px`                                                             | **Table body — the app's default size**                                                | ” sm                                                                                                                      |
| `--text-base`            | `16px / 24px`                                                             | Detail pane body, comments editor, all mobile inputs (16px prevents iOS zoom-on-focus) | ” base                                                                                                                    |
| `--text-lg`              | `18px / 26px`                                                             | Detail pane title, section headings                                                    | ” lg                                                                                                                      |
| `--text-xl`              | `20px / 28px`                                                             | Page title                                                                             | ” xl                                                                                                                      |
| `--text-2xl`             | `24px / 32px`                                                             | Empty-state headline                                                                   | ” 2xl                                                                                                                     |
| `--font-weight-normal`   | `400`                                                                     | Body                                                                                   | ”                                                                                                                         |
| `--font-weight-medium`   | `500`                                                                     | Table header labels, buttons                                                           | ”                                                                                                                         |
| `--font-weight-semibold` | `600`                                                                     | **Main task titles** (spec §10: "Main task **semibold**")                              | ”                                                                                                                         |
| `--letter-spacing-label` | `0.04em`                                                                  | Muted uppercase table header labels                                                    | ”                                                                                                                         |

### 2.8 Shadows

Spec §10: "subtle borders over heavy shadows". The scale is short on purpose.

| Token           | Placeholder                                                    | Use                               | Replace with       |
| --------------- | -------------------------------------------------------------- | --------------------------------- | ------------------ |
| `--shadow-none` | `none`                                                         | Default for rows and cards        | —                  |
| `--shadow-xs`   | `0 1px 2px rgb(2 6 23 / 0.04)`                                 | Sticky table header once scrolled | FinalInspection xs |
| `--shadow-sm`   | `0 1px 3px rgb(2 6 23 / 0.08), 0 1px 2px rgb(2 6 23 / 0.04)`   | Dropdowns, popovers               | ” sm               |
| `--shadow-md`   | `0 4px 8px rgb(2 6 23 / 0.08), 0 2px 4px rgb(2 6 23 / 0.04)`   | Detail pane on mobile overlay     | ” md               |
| `--shadow-lg`   | `0 12px 24px rgb(2 6 23 / 0.10), 0 4px 8px rgb(2 6 23 / 0.05)` | Modals, bottom sheet              | ” lg               |

In dark mode shadows are close to invisible. The dark values reduce every shadow to
`0 1px 0 var(--border-subtle)` or nothing, and elevation is carried by `--surface-raised` plus a
border instead. Do not simply increase shadow opacity in dark mode — it produces grey haloes.

### 2.9 Z-index layers

Named layers only. A raw `z-index` number in a component is a bug — it is how stacking-order wars
start.

| Token         | Placeholder | Use                                      |
| ------------- | ----------- | ---------------------------------------- |
| `--z-base`    | `0`         | Normal flow                              |
| `--z-sticky`  | `100`       | Sticky table header                      |
| `--z-drawer`  | `200`       | Mobile left-panel slide-over             |
| `--z-scrim`   | `300`       | Overlay behind drawer / sheet            |
| `--z-modal`   | `400`       | Dialogs, mobile percent bottom sheet     |
| `--z-popover` | `500`       | Dropdowns, date picker, column menu      |
| `--z-tooltip` | `600`       | Tooltips, the derived-percent ratio hint |
| `--z-toast`   | `700`       | Toasts, the ETag conflict banner         |

Replace with FinalInspection's layers **only if it has them**; if it uses raw numbers, keep this
set and do not import the disorder.

### 2.10 Motion

Spec §10 requires 150–200ms transitions and `prefers-reduced-motion` support.

| Token             | Placeholder                  | Use                                         |
| ----------------- | ---------------------------- | ------------------------------------------- |
| `--duration-fast` | `150ms`                      | Hover, checkbox toggle, focus ring          |
| `--duration-base` | `200ms`                      | Expand/collapse of subtasks, panel collapse |
| `--duration-slow` | `250ms`                      | Drawer and bottom-sheet slide               |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Everything                                  |

Under `@media (prefers-reduced-motion: reduce)` all three durations are redefined to `1ms` in
`tokens.css`. Because components reference the token rather than a literal, that single block
satisfies the requirement app-wide with no per-component work.

---

## 3. The brand accent — read before touching a colour

The placeholder brand accent is **`#29ABE2`**, taken from the spec's description of the
Modig-branded source workbook, whose header band is "roughly `#29ABE2`" (§10, Modig branding).

**The word "roughly" is doing real work there, and this hex must not be treated as the brand
colour.** It is an approximation of a colour seen in a spreadsheet screenshot. Per spec §10:

> Pull the **exact** brand hex from FinalInspection's tokens rather than sampling the screenshot.
> Both apps must agree.

Two reasons this is non-negotiable:

1. **Screenshot sampling is lossy.** JPEG compression, the display profile, and any opacity or
   overlay applied to the Excel header band all shift the sampled value. A hex read off a
   screenshot is typically several units out per channel — close enough to look right in isolation,
   obviously wrong when the two apps are open side by side.
2. **Two apps that disagree on brand blue look broken, not branded.** FinalInspection is already in
   use. It is the incumbent, so it is the source of truth; TaskHub matches it, not the other way
   round.

Until FinalInspection is available, treat `#29ABE2` as a stand-in that is deliberately _close
enough to design against and wrong enough not to ship_.

**Also note that `#29ABE2` cannot itself be used for text or focus rings on light surfaces** — see
§5. That constraint is a property of the colour's luminance and will very likely apply to the real
brand hex too, since it is a similarly light cyan-blue. The ramp is structured accordingly.

---

## 4. How to swap

When the FinalInspection repository becomes available:

1. **Get the path.** Ask the user for it explicitly (spec §10 step 1, and open question §17.5).
   Do not guess at a location or work from an exported screenshot.
2. **Read its token sources, in this order:**
   - its Tailwind config (`tailwind.config.{ts,js,cjs}`) — the `theme.extend` block gives the
     colour ramp, spacing, radii, type scale and shadows in one place;
   - its global CSS / `tokens.css` / `:root` block — CSS custom properties, and critically the
     **dark-mode block**, which reveals which ramp step each semantic alias maps to in each theme;
   - its **sidebar component** — the authority on left-panel width, collapsed rail width, item
     height, icon size, active-item treatment and section-label styling. Read it for values, and to
     understand the structure you are porting.
3. **Map its values onto the token table in §2.** Fill in the "Replace with" column with the real
   values before changing any code — the mapping is where the thinking happens, and a
   half-remembered mapping applied directly to CSS is how the two apps drift apart again.
   Where FinalInspection has no equivalent for a token (likely for z-index layers and motion),
   keep this file's placeholder and record that decision.
4. **Replace the values in `tokens.css` only.** Never in components. If a swap requires editing
   anything under `/web/src/features/` or `/web/src/components/`, that component had a hardcoded
   value and the real fix is to route it through a token. A useful review check:
   `grep -rEn '#[0-9a-fA-F]{3,8}\b' /web/src --include=*.tsx --include=*.ts` should return nothing.
5. **Update `tailwind.config.ts` only if token _names_ changed**, not when values changed. If the
   mirror is built correctly (`var(--color-accent-500)`), a pure value swap needs no config edit
   at all. That is the test of whether the mirror was built correctly.
6. **Rebuild the sidebar against the new tokens** — port it, do not copy-paste the component
   (spec §10 step 4). The two apps must be able to evolve independently.
7. **Re-check contrast** against §5 with the real values. This is not optional and it is not a
   formality: swapping in a real brand ramp changes every luminance in the table, and the ratios
   quoted in §2 no longer hold. Re-run every pair in §5.1.
8. **Verify both themes at all four breakpoints** — 360px, 768px, 1280px, 1920px (spec §10) — in
   light _and_ dark. A token swap that was only eyeballed in light mode is a token swap that
   is broken in dark mode.
9. **Record it in `DECISIONS.md`** with the date, the FinalInspection commit the tokens were taken
   from, and any place the two apps deliberately diverge.

---

## 5. Accessibility

### 5.1 Contrast requirements

**The accent must hold at least 4.5:1 against both light and dark surfaces wherever it is used for
text.** WCAG 2.1 AA: 4.5:1 for normal text, 3:1 for large text (≥24px, or ≥19px bold) and for
non-text UI components and focus indicators (1.4.11).

The placeholder ramp was chosen to satisfy this, and the measured ratios are:

| Pair                                     |      Ratio | Verdict                                                                                           |
| ---------------------------------------- | ---------: | ------------------------------------------------------------------------------------------------- |
| `accent-500` `#29ABE2` on white          | **2.62:1** | **Fails everything** — fails 4.5:1 for text and even 3:1 for non-text. Brand marks and logos only |
| `accent-600` `#1B8ABB` on white          |     3.89:1 | Non-text only: borders, hover states. Not for labels                                              |
| `accent-700` `#166D95` on white          |     5.74:1 | **Text-safe on light.** Primary button fill (with white label), links, focus ring                 |
| `accent-500` `#29ABE2` on `neutral-900`  |     6.82:1 | Text-safe on dark                                                                                 |
| `accent-400` `#46BAEA` on `neutral-900`  |     8.05:1 | **Preferred accent for text on dark**                                                             |
| `accent-700` `#166D95` on `neutral-900`  |     3.11:1 | **Fails for text on dark** — never reuse the light-theme accent in dark mode                      |
| `neutral-500` `#64748B` on white         |     4.76:1 | The muted-text floor. Nothing lighter may carry text on light                                     |
| `neutral-400` `#94A3B8` on `neutral-900` |     6.96:1 | Muted text on dark                                                                                |

Two conclusions that must survive the swap:

- **The brand blue itself is not a text colour on light surfaces.** Anything that needs a label, an
  icon that conveys meaning, or a focus ring on a light background uses `accent-700`, not
  `accent-500`. A filled primary button uses `accent-700` with `--text-on-accent`; filling it with
  `accent-500` and white text yields 2.62:1, which is unreadable.
- **Light and dark need different accent steps.** `accent-700` on dark is 3.11:1 and `accent-400`
  on light is worse still. This is exactly why components reference `--border-focus` and
  `--text-accent` rather than a ramp step.

After swapping to FinalInspection's real ramp, re-measure every row of that table. If its brand
blue also fails at the 500 step — which is likely — do **not** darken the brand colour. Keep the
brand hex intact for brand use and pick the ramp step that passes for functional use. Changing the
brand colour to satisfy a contrast checker is the wrong fix and the user will notice.

### 5.2 The accent is an accent

Restating the rule from spec §10 because it is the one most likely to be eroded over time:

**Use the brand blue for accent only** — primary buttons, the active nav item, focus rings, the
selected row. That is the complete list.

**Never paint a full-width saturated header band across the table.** The spec is blunt about why:
it is "the single strongest 'this is a spreadsheet' signal", and the entire point of the redesign
is to carry the Modig brand without carrying the Excel aesthetic. Table headers get a neutral
surface (`--surface-sunken`), a bottom border (`--border-subtle`), and muted uppercase label text
(`--text-muted` at `--text-xs` with `--letter-spacing-label`).

Also dropped, per the same section: yellow input-cell fills, Excel dropdown-arrow chrome, heavy
grid lines, and the dashed page-break rule. Row separation is 1px of `--border-subtle`, nothing
more.

### 5.3 Other token-layer accessibility obligations

- **Focus is always visible.** `--border-focus` at 2px with a 2px offset, on every interactive
  element, in both themes. Never `outline: none` without an equivalent replacement.
- **Colour is never the sole signal.** Completion is conveyed by the checkbox state and the percent
  text, not by green alone — this matters for the completed-task treatment where a main task can
  legitimately read "complete at 40%".
- **Touch targets** honour `--touch-target-min: 44px` on mobile. The 6px inline percent bar is not
  a target; mobile opens the bottom sheet instead (spec §10).
- **The logo must render legibly on both light and dark surfaces** (spec §10). Ask for an SVG, and
  check it against `--surface-sunken` in both themes — a logo with dark text baked in disappears on
  the dark sidebar. If the brand mark only works on one, it needs a second asset, not a
  filter hack.
