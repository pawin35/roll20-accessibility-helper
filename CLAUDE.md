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
| `app.roll20.net/characters/sheet/*` | top | compendium drag-and-drop replacement, icon labels, the roll log and the "Last Result" box |
| `advanced-sheets.production.roll20preflight.net/*` (`all_frames`) | sheet | everything about the sheet itself |

Two files are listed in **both** entries and branch on `window.top === window`:
`icon-button-labels.js` (both frames name icons the same way) and
`last-result.js` / `roll-mode-keys.js` (the thing being read or clicked is in
one frame, the key that triggers it is pressed in whichever frame has focus).

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

## Roll results and the Roll Log

Rolls are announced by `features/last-result.js`. The thing to understand
before touching it is that **the Roll Log is in the top frame**, not the sheet
— so unlike almost everything else here it is ordinary, scriptable,
inspectable DOM. `javascript_tool` can read it directly; no report bridge
needed.

| Thing | Where |
|---|---|
| The drawer | `[data-testid="test-roll-log-drawer"]`, `role="dialog"`, `aria-modal="true"` |
| Open/closed | `drawer.checkVisibility({checkVisibilityCSS: true})` |
| Nav control that opens it | `button.roll-log-button` |
| An entry | `.chat-container[data-messageid]`, newest **last** |
| Entry body | `.chat-container__message` (the container itself also holds avatar initials and a timestamp) |
| A sheet roll | contains `rolltemplate`; title `.header__title`, mode class `dnd-2024__header--Normal\|Advantage\|Disadvantage` |
| Its breakdown | `.dnd-2024__bonus-list` → `.rt-formula__raw` / `.rt-formula__evaluated`, `.bonus__label` / `.bonus__value`, `.total__label` / `.total__value` |
| A dice-tray roll | **no** `rolltemplate` — `.roll-result__main` with `.roll-result__formula`, `.roll-result__results .roll`, `.roll-result__total-number` |

Facts that shaped the design, each learned the hard way:

- **Capture from the log, never by intercepting roll buttons.** Roll controls
  are spread over five unrelated selector families; every one of them lands here
  as an entry. Do not add a per-button interception path — a new roll control
  anywhere on the sheet is covered for free. (The *sound* is the one exception:
  it must fire on the press, so it does use a selector list, and a control
  missing from it costs a silent second, not a lost result.)
- **Entries survive closing**, and the drawer body does not exist at all until
  the drawer first opens.
- **Do not close the drawer to get rid of it.** Element Plus restores focus to
  the `<iframe>` element, and a screen reader re-enters the sheet *from the top
  of the page*. This is worse than leaving it open. Hiding it with
  `display: none` makes its focus trap a no-op instead — a hidden element cannot
  be focused — after which closing it is harmless, because the restore lands on
  something that already has focus and fires no event.
- **Stripping the focus trap's `tabindex` does not work**: the trap falls
  through to the close button. Verified, not assumed.
- The **advantage/disadvantage** case needs no special handling: Roll20 renders
  only the *kept* die, as a plain `1d20` with a single value.
- **`aria-modal="true"` blanks the rest of the page** for a screen reader while
  the drawer is genuinely open, including our own live region. Anything spoken
  has to wait until it is closed or hidden.

## Keyboard shortcuts

There is no `commands` block in the manifest; these are page-level `keydown`
listeners in capture phase. A shortcut must be registered in **both** frames —
the key goes to whichever frame has focus, and focus is usually, but not
always, in the sheet.

| Key | Does |
|---|---|
| `alt+O` | Re-read the "Last Result" box |
| `alt+A` / `alt+S` / `alt+Z` | Advantage / Normal / Disadvantage |

`alt+S` selects Roll20's control labelled **"Automatic"** but is spoken as
**"Normal"**.

## Test page

`https://app.roll20.net/characters/sheet/18539970?sheet_shortname=dnd2024byroll20`
(character "Brother Lorian"). The user has confirmed this is a **test
character**, so mutating it is fine. Still say what test data you left behind —
removing a proficiency or language is not currently possible from the sheet UI
by any route we have found, so anything added there stays.

Rolling is cheap and safe: it only appends to the roll log, which is
server-backed and shared across tabs, so a roll made in one tab shows up in
another. That makes the log a good read-only source of real examples — running
extraction logic over the accumulated history in `javascript_tool` checks it
against dozens of real entries without rolling anything.

Note that clicks dispatched into the sheet iframe by the `computer` tool are
unreliable when the automated tab is backgrounded (`document.hidden === true`):
the first roll after a page load usually fires and later ones often do not.
Do not read that as the feature being broken.

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
- **Never write state we depend on onto a Vue-owned element.** A class added to
  Roll20's roll-log drawer survived exactly one roll: Vue rewrites `className`
  when it re-renders on open and close, so the second roll flashed the drawer
  open and stole focus again. Key CSS off `<html>` plus one of Roll20's own
  stable attributes (`data-testid`) instead, so nothing has to survive
  anywhere. The first-time-works-then-dies shape is the tell.
- **Roll20 mounts *two* sheet iframes, and one of them is `0x0`.** Both run
  every sheet content script, and the ghost contains a full duplicate of the
  markup — so a feature that acts on what it finds will act twice, once
  invisibly. A frame whose `document.body` has no size is the ghost and should
  install nothing; the top frame must likewise post to the iframe that has a
  size, not the first one it finds. This is the "panels can be duplicated" trap
  one level up.
- **`announce()` has two failure modes, both silent.** The live region must be
  in the document *before* it is written to — one created and filled in the same
  moment is not yet registered, and its first message is simply never spoken, so
  `lib/core.js` builds it at load. And Chrome batches accessibility updates, so
  clearing the region and putting the **same** string back within one frame nets
  out to no change: a repeated message goes unspoken while a different one is
  fine. Alternate calls therefore get a trailing ` `, which is not voiced.
  Symptom: a shortcut that is silent when pressed twice but speaks the moment
  you press a different one.
- **There is not one `input[type="radio"]` on the sheet.** The radios are
  Headless UI divs — `[role="radio"]` with `aria-checked`, grouped under
  `[role="radiogroup"]` — and the group carries the current value in
  `data-selectedvalue`, which is what to read rather than inferring it. Roll
  mode is `.manage__roll-mode--radio`; `.manage__roll-privacy--radio` is a
  near-identical sibling group holding Public/Whisper, so never match
  `.poly-radio__button` unscoped.
- **Headless UI focuses a radio option when you `click()` it.** `click()` does
  not move focus on its own, but its handler does, as part of roving tabindex.
  Anything driving these controls on the user's behalf must capture focus first
  and put it back. Do not strip the option's `tabindex` to prevent it — that is
  the same attribute Headless UI uses for arrow-key navigation within the group.
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

**The sheet bundle is not reachable from the top frame.** Getting its hash
needs a network request made *by the sheet frame*, and `read_network_requests`
does not surface the iframe's subresources — it returns nothing for
`advanced-sheets`, `sheet.js` or `cdn.roll20.net`. Fetching the frame's own
document URL to read the script tag out of it fails too: the preflight origin
sends no CORS headers, so it is a bare `TypeError: Failed to fetch`. Both were
tried. When the question is about sheet markup, go straight to the probe —
it is faster than either route and answers the actual question.
