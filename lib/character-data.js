/**
 * Asking the page world for the current character's model.
 *
 * `page/character-bridge.js` lives in the same window, so this is a
 * postMessage to ourselves and back — one task, not a network round trip.
 * Requests are still correlated by id: two keypresses in quick succession must
 * not have their replies swapped.
 *
 * Shared by every shortcut that reads the character (attack rolls, spell slots,
 * hit points), so there is one place that knows the protocol and one timeout to
 * tune. Inert in any frame that never calls it — the sheet frame's halves only
 * forward keys upward.
 */
(function () {
  "use strict";

  const TOP_ORIGIN = "https://app.roll20.net";
  const REQUEST_TIMEOUT_MS = 1500;

  let requestSeq = 0;
  const pending = {};

  window.addEventListener("message", (event) => {
    if (event.origin !== TOP_ORIGIN) return;
    const data = event.data && event.data.r20a11yCharacterData;
    if (!data) return;
    const waiting = pending[data.requestId];
    if (!waiting) return;
    delete pending[data.requestId];
    window.clearTimeout(waiting.timer);
    waiting.resolve(data);
  });

  /**
   * Resolves with the bridge's reply, or `null` if it never came.
   *
   * The reply carries `{ name, integrants, spellSlots, hitpoints, meta }`, or
   * an `error` of "no-character" / "no-store" with `integrants` null.
   */
  function requestCharacter(name) {
    return new Promise((resolve) => {
      const requestId = "r" + ++requestSeq;
      // setTimeout, never requestAnimationFrame: rAF does not run at all while
      // the tab is backgrounded, so an rAF deadline would never fire.
      const timer = window.setTimeout(() => {
        delete pending[requestId];
        resolve(null);
      }, REQUEST_TIMEOUT_MS);
      pending[requestId] = { resolve, timer };
      try {
        window.postMessage({ r20a11yCharacterRequest: { requestId, name } }, TOP_ORIGIN);
      } catch (e) {
        window.clearTimeout(timer);
        delete pending[requestId];
        resolve(null);
      }
    });
  }

  window.Roll20A11y.requestCharacter = requestCharacter;
})();
