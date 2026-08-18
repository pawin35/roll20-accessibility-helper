/**
 * Feature: set the VTT's "speaking as" selector to the player's own character.
 *
 * The chat box's "As:" dropdown (`#speakingas`) defaults to the player's
 * account name, so anything sent from the box goes out-of-character. The first
 * character the player controls is picked instead — the same "first
 * `character|…` option, alphabetically" rule the roll shortcuts use — and
 * selected once that option has populated.
 *
 * This is also part of what "ready" means: the roll shortcuts and the chat
 * send both read `#speakingas`, so the page is not fully usable until it is
 * populated. `markReady("speaking")` reports that moment; a generous timeout is
 * the failsafe so a missing dropdown cannot hold the "Table ready." signal
 * forever.
 */
(function () {
  "use strict";

  const { debug, markReady } = window.Roll20A11y;

  // VTT top frame only: the dropdown lives here, not in the sheet iframe.
  if (window.top !== window) return;

  const SEL_AS = "#speakingas";
  const SWEEP_MS = 500;
  // At least as long as the chat gate's own 20s ceiling; readiness must never
  // hang on this dropdown even if Roll20 renames or hides it.
  const MAX_ATTEMPTS = 40;

  /** The first `character|…` option, alphabetically, or null when there is none. */
  function firstCharacter(sel) {
    const chars = [];
    for (const opt of sel.options) {
      if (String(opt.value || "").indexOf("character|") === 0) {
        const text = (opt.text || "").trim();
        if (text) chars.push({ value: opt.value, text });
      }
    }
    if (!chars.length) return null;
    chars.sort((a, b) => a.text.localeCompare(b.text));
    return chars[0];
  }

  let ready = false;
  let attempts = 0;

  function sweep() {
    const sel = document.querySelector(SEL_AS);

    // Readiness: the moment the dropdown holds any option, the chat is usable.
    if (!ready && sel && sel.options && sel.options.length) {
      ready = true;
      markReady("speaking");
    }

    // Selecting a character is best-effort and can lag readiness: the options
    // arrive in stages — the account first, then the controlled characters —
    // so keep looking until the character option shows up rather than settling
    // for the account name.
    if (ready && sel && sel.options) {
      const opt = firstCharacter(sel);
      if (opt) {
        if (sel.value !== opt.value) {
          sel.value = opt.value;
          // A plain native select bound by Roll20 with jQuery; the change event
          // is what lets Roll20 notice and read the new value.
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          debug("speakingas", "speaking as " + opt.text);
        }
        return;
      }
    }

    if (attempts >= MAX_ATTEMPTS) {
      if (!ready) markReady("speaking");
      return;
    }
    attempts++;
    window.setTimeout(sweep, SWEEP_MS);
  }

  sweep();
})();
