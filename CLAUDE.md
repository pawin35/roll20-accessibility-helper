# CLAUDE.md

Guidance for working in this repo.

## What this is

**Roll20 Accessibility Helper** — an unofficial Manifest V3 Chrome extension
that replaces mouse-only interactions on Roll20's character sheet page with
keyboard- and screen-reader-accessible controls.

No build step, no dependencies, no framework. Plain content scripts loaded
directly from this folder as an unpacked extension.

## Layout

```
manifest.json                            MV3 config; content_scripts.js order matters
styles.css                               all classes namespaced `r20a11y-`
lib/core.js                              shared helpers, MUST load first
features/<one-file-per-feature>.js       features
```

All content scripts share one isolated-world global scope. `lib/core.js`
publishes `window.Roll20A11y`; feature files consume it and must be listed
**after** it in `manifest.json`.

## Testing — you must reload AND refresh

There is no test suite. Changes are verified by hand in Chrome:

1. `chrome://extensions` → **Reload** on the extension card.
2. **Refresh the Roll20 tab.**

Both steps, every time. A content script already running in an open tab is
*not* replaced when the extension reloads — the page must reload too. Skipping
step 2 produces a stale script that silently ignores your changes, which looks
exactly like a broken feature. This burned us repeatedly.

Claude cannot open `chrome://extensions` (browser-internal pages are blocked
from automation), so **ask the user to do the reload** and then verify against
the live page.

Before handing anything over, at minimum:

```bash
node --check lib/core.js
node --check features/*.js
python3 -c "import json;json.load(open('manifest.json'))"
```

## Test page

`https://app.roll20.net/characters/sheet/18539970?sheet_shortname=dnd2024byroll20`
(character "Brother Lorian"). It is the user's real character — adding items
mutates real data. Prefer a throwaway character for bulk testing, and tell the
user what test data you left behind.

Never simulate a **real mouse drag** (`computer` tool `left_click_drag`) on the
sheet: a drag that ends over an input has corrupted character stats (HP) before.
Dispatch DOM events at specific elements instead — that is what the extension
does and it cannot touch unrelated fields.

## Critical invariants

Roll20's page is Vue-based. These caused real, hard-to-diagnose bugs:

- **Render is asynchronous.** Never `querySelector` for an app-rendered element
  on the same tick as the event that creates it — it will be `null`. Use
  `Roll20A11y.waitForElement()`.
- **Poll with `setTimeout`, never `requestAnimationFrame`.** rAF is fully
  paused while a tab is backgrounded, so an rAF poll hangs forever instead of
  timing out. Applies to `announce()` too.
- **Always fire `dragend`, including on failure paths.** It clears
  `isPageBeingDragged`; leaving it set keeps a stale `.compendium-dropzone`
  mounted and breaks the next action.
- **The sheet is a cross-origin iframe** (`advanced-sheets...roll20preflight.net`).
  You cannot script into it. Everything must go through the top-level document.

## Conventions

- Features never query the DOM once at startup — Roll20 renders results long
  after load. Register with `Roll20A11y.enhance(selector, onMatch)` and keep
  `onMatch` idempotent via `markOnce`.
- Every user-visible action announces its outcome through
  `Roll20A11y.announce()`. Roll20's own toasts are not reliably announced.
- Prefix all injected classes and data attributes with `r20a11y-`.
- Fail safe and say so: if an expected element is missing, announce a plain
  failure message rather than throwing or silently doing nothing.
- This depends on undocumented Roll20 internals (`.compendium-page__upper`,
  `.compendium-dropzone`, the `page` dataTransfer key). When touching that
  logic, re-verify against the live bundle rather than trusting these notes.

## Re-inspecting Roll20's bundle

The behaviour above was reverse-engineered from
`https://cdn.roll20.net/production/enhanced-character-vault/main.js` (~12 MB,
minified). Fetch it in the page and string-search it. Note the browser tool
blocks returning long raw slices; replacing `=` and `;` before returning the
string works around it.
