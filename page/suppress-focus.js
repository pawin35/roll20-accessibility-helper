/**
 * Suppress a programmatic focus during synthetic activation.
 *
 * *** This file runs in the PAGE's world, not the extension's. ***
 *
 * It is registered with `"world": "MAIN"` in manifest.json, so it has **no
 * access to `chrome.*`, to `window.Roll20A11y`, or to anything else the rest of
 * the extension sets up** — those live in the isolated world and are invisible
 * from here. Keep it self-contained.
 *
 * --- Why it has to be here and not in a content script -------------------
 *
 * Roll20's controls are driven from the isolated world by calling `.click()` on
 * them, and some of them move focus as a side effect of handling that click —
 * Headless UI radio options focus themselves as part of their roving-tabindex
 * behaviour, and the chat box focuses its textarea on send. A shortcut that
 * means to change a setting in place instead yanks focus to the control and
 * back, and the return is re-announced by a screen reader.
 *
 * The move is a `.focus()` call in the page's world, and an isolated-world
 * script cannot intercept it: it has its own copy of `HTMLElement.prototype`,
 * exactly as it has its own `HTMLMediaElement.prototype` (see
 * `suppress-roll-beep.js`). A `world: "MAIN"` script is the only way to get at
 * the call.
 *
 * --- The contract ---------------------------------------------------------
 *
 * A feature marks the element it is about to activate with the attribute
 * `data-r20a11y-no-focus` (the constant `NO_FOCUS_ATTR` in `lib/core.js`), then
 * clicks, then removes the marker in its confirmation callback. While the
 * marker is present, `focus()` on that element is a no-op. Everything else is
 * passed straight through untouched, so no other focus on the page can be
 * broken by this.
 *
 * The marker lives on a specific element, not on a timer, so the suppression is
 * scoped to exactly the one element a feature is driving — a legitimate focus
 * elsewhere in the same moment is never swallowed.
 *
 * The feature's own `.focus()` calls are unaffected regardless: those run in
 * the isolated world, whose prototype this patch never touches.
 */
(function () {
  "use strict";

  // The page world persists across soft navigations and this file could be
  // injected more than once; patching a patch would stack wrappers.
  if (window.__r20a11yFocusShim) return;
  window.__r20a11yFocusShim = true;

  // Must match the string exposed as `Roll20A11y.NO_FOCUS_ATTR`. The two worlds
  // cannot share a symbol, so this is duplicated on purpose.
  const ATTR = "data-r20a11y-no-focus";

  const focus = HTMLElement.prototype.focus;

  HTMLElement.prototype.focus = function () {
    if (this && this.hasAttribute && this.hasAttribute(ATTR)) {
      // `focus()` returns undefined, so returning nothing is indistinguishable.
      return;
    }
    return focus.apply(this, arguments);
  };
})();
