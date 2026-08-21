# 2026-08-21 - UI elevation: tokens, dark-first theme, keyboard flows

Lane A work: raise the in-app UI in `runtime/ui/` to a professional standard without breaking
the architecture, the public API of the view-model layer, or any house rule.

## What changed

- **A token layer**: new `runtime/ui/tokens.css` declares every visual decision as a CSS custom
  property: an 8-step 4px spacing scale, a 1.25 type scale on a 15px base, the dark color ramp,
  semantic status colors, three radii, two shadows, three motion durations, and the one accent,
  `#3DD8F5`, declared exactly once. `runtime/ui/style.css` was rewritten to spend those tokens and
  declare no literal color or use of the CSS important keyword of its own. Tests pin the color,
  font and important-keyword parts of this.
- **Dark first.** The product runs in warehouses and back offices; dark is now the default
  `color-scheme` and light follows `prefers-color-scheme`. Every text color in both themes was
  checked for WCAG AA (4.5:1 for normal text) before shipping; the worst pair is tertiary ink at
  4.8:1 on a hover fill, everything else is 5.3:1 or better. Because `#3DD8F5` on white is 1.7:1,
  the light theme gets a separate `--accent-text` (`#067180`, 5.7:1) for links; the accent hue
  itself does not change.
- **The accent has a budget**: four sites per view, and no more: the focus ring, the primary
  action, the active navigation item (a 2px leading border, not a filled pill), and interactive
  text. The brand mark went neutral to stay inside the budget.
- **Keyboard flows, for real.** New `runtime/ui/keys.js` is a pure state machine (a cursor is an
  index; a keypress maps to the next index, clamped, with Home/End and Page keys; Enter activates;
  Escape leaves). Tables got roving tabindex: one row is in the tab order, arrows move, Enter
  opens. The refusal panel takes focus when it appears and Escape dismisses it. Forms cancel on
  Escape. The shell gained a skip link, an `aria-label` on the nav, and `aria-current="page"` on
  the active item. Table headers got `scope="col"`, and form controls with a declared problem get
  `aria-invalid`.
- **Focus survives a re-render.** Views are rebuilt wholesale, so typing in the list filter used
  to drop focus on every keystroke. Controls that opt in with `data-keep-focus` are refocused
  after render, with the caret restored. This was a functional defect, not a polish item.
- **Motion discipline**: transitions run only on non-layout properties (color, background,
  border), 120-200ms ease-out, all through duration tokens. `prefers-reduced-motion` sets the
  three duration tokens to 1ms in one place, so no component needs its own override and the CSS important keyword
  appears nowhere in the stylesheet. No scroll listeners were added; a test proves none exist.
- **Density and depth**: sticky table headers inside a 72vh scroll region, sticky topbar with a
  real shadow, cards on a raised surface with a one-step elevation model, tabular numerals kept,
  uppercase microcopy labels over stat values.

## Constraints honored

- Zero dependencies, no build step, no frameworks: the whole change is hand-written CSS and JS.
- Principle 7 intact: no entity name anywhere in the new code; the mechanical guard still passes.
- The public API of `viewmodel.js` and `fields.js` is untouched; both files are unmodified.
- The PWA shell lists (`runtime/ui/shell-files.js` and `service-worker.js`) gained `tokens.css`
  and `keys.js` in lockstep; the byte-identity test passes, and the module-graph test still
  matches the real imports.
- No U+2014 or U+2013 anywhere in the changed files (the pre-existing em dashes in the six files
  this change had to touch were replaced with hyphens or restructured sentences, so the files are
  clean end to end, not only in the new lines). No exclamation marks in any string or comment in
  the changed or new files.
- Copy keeps the house voice: no superlatives, no claims that are not checkable.

## Explicitly not done

- **No IntersectionObserver reveals.** Views re-render on every state change, including each
  filter keystroke; an entrance animation would replay constantly. Motion is transitions only.
- **No per-view redesign of the refusal panel's content model.** Its information architecture
  (reason, verbatim sentence, file and line, fix button) was already the strongest screen; the
  change is typographic and interactive (focus, Escape), not structural.
- **No light-theme re-tuning beyond contrast.** Light follows the OS and is AA-compliant, but the
  design effort went into dark, which is the documented default.
- **`confirm()`/`prompt()` dialogs for delete and new-file remain native.** Replacing them with
  in-app dialogs is a behavior change with its own review surface; noted as follow-up work.
- **No snapshot or pixel tests.** The DOM-mock convention in `test/g-ui.test.js` was kept; the new
  tests cover decisions (the key state machine) and invariants (the token contract), not pixels.
