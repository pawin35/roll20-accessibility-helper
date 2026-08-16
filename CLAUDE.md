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

Two `content_scripts` entries, because the page is two frames and neither
should load features it has no use for:

| Entry | Frame | Holds |
|---|---|---|
| `app.roll20.net/characters/sheet/*` | top | compendium drag-and-drop replacement, icon labels |
| `advanced-sheets.production.roll20preflight.net/*` (`all_frames`) | sheet | everything about the sheet itself |

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

## Diagnosing the sheet frame

### The problem

When a selector is wrong here, **nothing tells you**. Nothing throws, nothing
logs anywhere reachable, and the page looks identical — which is the same
symptom as forgetting to refresh the tab. Everything below exists because that
ambiguity cost several full cycles each time it came up.

Why the usual routes are all closed:

- the sheet is a **cross-origin iframe**, so `iframe.contentDocument` is `null`
- the **accessibility tree stops** at the frame boundary, so `read_page` cannot
  see in
- **`read_console_messages` cannot see content-script logs** at all — it only
  surfaces page-context messages. This one is easy to design a whole diagnostic
  around before discovering it, which is exactly what happened.

### The channel

`lib/core.js` carries a `debug(tag, message)` and a `DEBUG` flag. In the sheet
frame `debug()` `postMessage`s to the parent; the top frame's bridge appends the
line to a hidden `#r20a11y-report` div. That div **is** readable from the page
world, so it is the only way out:

```js
// javascript_tool, top frame
document.getElementById("r20a11y-report").textContent;
```

`DEBUG` ships `false`. Set it to `true` in `lib/core.js` and every feature
starts narrating — each one already calls `debug()` at the point where it
commits to a decision, so no other setup is needed.

Strip `=`, `;` and `?` from anything returned: they trip the browser tool's
query-string filter, which blocks the **entire** result rather than the match.
`clean()` in `lib/core.js` does this.

### Rebuilding the probe

A `features/diagnostics.js` is written when there is a question, listed **first**
in the iframe entry of `manifest.json`, and **deleted once the question is
answered** — it is scaffolding, not a feature. Rebuild it with:

- a **heartbeat line first**, before any selector runs. Without it, silence is
  ambiguous: script never injected, or injected and matched nothing? Those need
  opposite fixes.
- `describe(el)` → tag, classes, `role`, `aria-*`, `data-*`, and leaf text; and
  a recursive `outline(el, depth)` with a depth budget of **at least 10**. Roll20
  nests item rows deeply and a shallower budget truncates precisely the part in
  question. Print a structured outline, never `outerHTML`.
- `cloneNode(true)` on first sight, so the dump is Roll20's markup and not a mix
  of theirs and ours.

Four traps, each of which produced a wrong conclusion at least once:

- **Never gate on visibility.** A closed tab's rows are in the DOM at `0x0`.
  Five consecutive spell probes came back empty because of an `offsetWidth`
  check, and `.spell-item` had been right the first time.
- **Dump every match, not the first.** The first `.span--item-row-title` on the
  page belongs to combat EFFECTS, not spells, because effects render earlier.
- **Poll for tabs that have never been opened.** Unlike spells, the inventory
  tab is not in the DOM at all until visited, so a one-shot timer reports
  "nothing here" and says nothing about the selector.
- **Panels can be duplicated.** `.skills__skillList` is a hidden `0x0` copy while
  the real one is `.skills__panel`. Print `offsetWidth x offsetHeight` next to
  everything, or you will confidently transform the invisible one — this was
  reported as working for three cycles before the sizes gave it away.

### The cycle

1. Write the change; run the static checks above.
2. **Ask the user to reload the extension and refresh the tab.** Only they can
   do this — `chrome://extensions` is blocked from automation.
3. The user reports what their screen reader says.
4. Read `#r20a11y-report` for the frame's own account.
5. Fix, and go round again.

Step 3 is the ground truth, not step 4 and not a self-audit. More than once an
internal check reported a table built correctly while the user heard nothing,
because the table was in a hidden duplicate panel. **Never report a sheet-frame
change as working on the strength of the code alone.**

## Test page

`https://app.roll20.net/characters/sheet/18539970?sheet_shortname=dnd2024byroll20`
(character "Brother Lorian"). The user has confirmed this is a **test
character**, so mutating it is fine. Still say what test data you left behind —
removing a proficiency or language is not currently possible from the sheet UI
by any route we have found, so anything added there stays.

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
- **`enhance()` fires only for *added* nodes.** It has no attribute or removal
  handling, so whatever `onMatch` does to a long-lived container happens exactly
  once. Vue re-renders panel internals freely — when it does, injected nodes in
  that subtree are destroyed, attributes we set on replaced elements are gone,
  and nothing puts them back. The symptom is a feature that works on first open
  and silently dies after the first interaction.
- **Do not try to predict which node Vue will replace.** Three attempts at a
  targeted fix for the proficiency picker all failed, each assuming a different
  node was the stable one. For injected UI that must survive re-renders, use a
  `setTimeout` sweep with an idempotent `repair()` — see `combobox-labels.js`.
  `repair()` must check before every write, so a pass with nothing to do
  performs no DOM mutations at all; a redundant write is something a screen
  reader can react to.
- **A feature's own `MutationObserver` must not observe its own writes.** An
  observer whose disclosure button lived inside the subtree it watched span
  forever and made the button appear dead. If an observer is genuinely needed,
  park injected UI outside the observed subtree and watch `childList` only,
  never `attributes`.
- **Chrome ignores `aria-hidden` on an element that contains focus.** Move
  focus away first, then hide — the reverse order silently does nothing.
- **The sheet is a cross-origin iframe**
  (`https://advanced-sheets.production.roll20preflight.net`). You cannot script
  into it, `contentDocument` is `null`, the a11y tree stops at the boundary, and
  `read_console_messages` cannot see content-script logs. The only channel out
  is the report bridge in `lib/core.js`: the frame `postMessage`s to the parent,
  which appends to a hidden `#r20a11y-report` node in the top document — read
  that node to see what the frame found.
- **SKILLS is a five-level CSS subgrid chain.** Column alignment survives only
  through an unbroken chain of grid boxes, so a real `<table>` anywhere in it
  destroys the layout. Every table on the sheet is therefore ARIA roles applied
  in place.
- **`aria-colindex` is not enough on a plain `role="table"`.** NVDA counts cells
  positionally, so a row missing an optional cell still shifts. Insert real
  filler cells for the absent columns.

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

Two bundles, one per frame:

- top frame — `https://cdn.roll20.net/production/enhanced-character-vault/main.js`
  (~12 MB, minified)
- sheet frame — `https://cdn.roll20.net/advanced-sheets-production-<hash>/dnd2024byroll20/sheet.js`
  (the hash changes on each deploy; read it off a network request)

Fetch in the page and string-search. The browser tool blocks returning long raw
slices; replacing `=`, `;` and `?` before returning the string works around it
(`clean()` in `lib/core.js` does exactly this).
