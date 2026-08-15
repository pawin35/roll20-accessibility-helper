# Roll20 Accessibility Helper

An unofficial Chrome extension that makes [Roll20](https://roll20.net)'s
character tools usable without a mouse.

Parts of Roll20's newer character sheet UI can only be operated by dragging
with a mouse. That locks out blind screen-reader users and anyone who can't
perform a precise drag gesture. This extension adds ordinary, focusable,
labelled controls that perform the same actions.

## Features

| Feature | What it does |
| --- | --- |
| **Compendium → Add to Character** | Adds an **Add to Character** button to every Compendium search result, replacing the mouse-only drag-and-drop needed to add an item to a character's inventory. |

Every action reports its result through a visually-hidden `aria-live` region,
so a screen reader always announces whether it succeeded.

## Installing (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this folder.
4. Open a character sheet at
   `https://app.roll20.net/characters/sheet/<id>?sheet_shortname=dnd2024byroll20`,
   open the Compendium panel, and search. Each result now has an
   **Add to Character** button.

After changing any file, press **Reload** on the extension card *and* refresh
the Roll20 tab — a content script already running in an open tab is not
replaced until the page reloads.

## Project layout

```
manifest.json                            Manifest V3 config
styles.css                               Shared styles (all `r20a11y-` prefixed)
lib/core.js                              Shared helpers, loaded first
features/compendium-add-to-character.js  One feature per file
```

All content scripts share a single isolated-world global scope, so
`lib/core.js` publishes helpers on `window.Roll20A11y` for the feature files
listed after it in `manifest.json`.

### `window.Roll20A11y`

| Helper | Purpose |
| --- | --- |
| `enhance(selector, onMatch)` | Calls `onMatch(el)` for every current **and future** element matching `selector`. Roll20 renders content long after load, so features never query the DOM once. |
| `markOnce(el, key)` | `true` the first time only — makes `onMatch` idempotent. |
| `waitForElement(selector, opts)` | Resolves when an element appears, or `null` on timeout. |
| `announce(message)` | Speaks a message via the shared polite live region. |
| `createButton({label, ariaLabel, onActivate})` | A consistently styled, keyboard-accessible button. |

### Adding a feature

Create `features/your-feature.js`, add it to `content_scripts.js` in
`manifest.json` (after `lib/core.js`), and use `enhance()` to attach controls.

## How the Compendium feature works

Reverse-engineered from Roll20's own client bundle
(`enhanced-character-vault/main.js`):

1. Each result row is
   `<div class="compendium-page__upper" draggable data-pagename="Items%3ALongsword"
   data-expansionid="33335">`. Its own `dragstart` handler calls
   `dataTransfer.setData('page', JSON.stringify({id, name, book, category}))`,
   so the payload never has to be reconstructed by hand.

2. That same `dragstart` **bubbles up** to the `CompendiumPanel` component,
   which emits `dragItemStart`. The root component flips a ref passed down as
   the `isPageBeingDragged` prop, and the drop target is rendered only behind
   that condition:

   ```js
   isPageBeingDragged ? createBlock(CompendiumDropZone) : createCommentVNode()
   ```

   So `.compendium-dropzone` **does not exist in the DOM** until a `dragstart`
   fires; a matching `dragend` unmounts it again.

3. The mounted dropzone's `drop` handler (`handleCompendiumDropItem`) reads
   `dataTransfer.getData('page')` and forwards
   `{pageName, category, expansion}` over a `MessageChannel` into the
   character-sheet iframe, which fetches full stats and saves the item.

The extension therefore dispatches `dragstart` on the row, **waits for the
dropzone to appear**, dispatches `dragenter` → `dragover` → `drop` at it, then
`dragend` to clean up. No mouse movement and no cross-origin scripting into the
sheet's iframe are involved — only DOM events dispatched at specific elements.
Because nothing depends on where the pointer is, elements do not need to be
scrolled into view or visible.

### Timing gotchas (these caused real bugs — don't regress them)

- **Vue renders asynchronously.** Checking for `.compendium-dropzone`
  synchronously right after dispatching `dragstart` always finds `null`. You
  must poll for it.
- **Poll with `setTimeout`, never `requestAnimationFrame`.** rAF is paused
  entirely while a tab is in the background, so an rAF poll hangs forever
  instead of timing out. (Verified: a backgrounded tab reports
  `visibilityState: "hidden"` and never fires rAF.) This applies to
  `announce()` too.
- **Always dispatch `dragend`, including on the failure path.** Leaving the
  flag set keeps a stale dropzone mounted and breaks the next add.

## Limitations

- Scoped to `app.roll20.net/characters/sheet/*`. Not tested inside a live VTT
  game session, where the markup may differ.
- Verified end-to-end for the **Items** category (weapons and armor),
  including several consecutive adds in one session. Spells, Feats and
  Features use the same code path — the category travels inside the row's own
  `dragstart` payload — but have not been tested.
- This relies on Roll20's internal, undocumented DOM structure and message
  shapes. It is **not** a public API, and a Roll20 deploy can change class
  names or payloads without warning. The code fails safe: if a required
  element is missing it announces a failure rather than throwing silently.
- Unaffiliated with Roll20.
