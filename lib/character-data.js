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

  // Writing goes through the sheet worker and Firebase rather than straight to
  // the model, so it is a different order of magnitude — ~150 ms when the relay
  // is warm, and the bridge may have to try both relays before it finds one
  // that answers.
  const WRITE_TIMEOUT_MS = 6000;

  let requestSeq = 0;
  const pending = {};

  /** Match a reply to its request; two keypresses must not swap answers. */
  function settle(data) {
    if (!data) return;
    const waiting = pending[data.requestId];
    if (!waiting) return;
    delete pending[data.requestId];
    window.clearTimeout(waiting.timer);
    waiting.resolve(data);
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== TOP_ORIGIN) return;
    const message = event.data || {};
    settle(message.r20a11yCharacterData);
    settle(message.r20a11ySetHpResult);
  });

  /** Post `payload` under `key` and resolve with the reply, or null. */
  function ask(key, payload, timeoutMs) {
    return new Promise((resolve) => {
      const requestId = "r" + ++requestSeq;
      // setTimeout, never requestAnimationFrame: rAF does not run at all while
      // the tab is backgrounded, so an rAF deadline would never fire.
      const timer = window.setTimeout(() => {
        delete pending[requestId];
        resolve(null);
      }, timeoutMs);
      pending[requestId] = { resolve, timer };
      try {
        const message = {};
        message[key] = Object.assign({ requestId }, payload);
        window.postMessage(message, TOP_ORIGIN);
      } catch (e) {
        window.clearTimeout(timer);
        delete pending[requestId];
        resolve(null);
      }
    });
  }

  /**
   * Resolves with the bridge's reply, or `null` if it never came.
   *
   * The reply carries `{ name, integrants, spellSlots, hitpoints, meta }`, or
   * an `error` of "no-character" / "no-store" with `integrants` null.
   */
  function requestCharacter(name) {
    return ask("r20a11yCharacterRequest", { name }, REQUEST_TIMEOUT_MS);
  }

  /**
   * Set the character's current hit points, through the sheet's own setter.
   *
   * Resolves `{ ok, current }` on success, or `{ ok: false, error }` — and
   * `null` if the bridge never answered at all. Writing is not a read: it
   * persists, broadcasts to the rest of the table, and cannot be undone from
   * here, so callers should confirm what actually landed rather than assume the
   * value they asked for (the setter clamps at zero).
   */
  function setCharacterHp(name, value) {
    return ask("r20a11ySetHp", { name, value }, WRITE_TIMEOUT_MS);
  }

  window.Roll20A11y.requestCharacter = requestCharacter;
  window.Roll20A11y.setCharacterHp = setCharacterHp;
})();
