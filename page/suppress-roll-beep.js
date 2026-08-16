/**
 * Drop Roll20's chat beep when the message that caused it is a dice roll.
 *
 * *** This file runs in the PAGE's world, not the extension's. ***
 *
 * It is the only file here that does, and it is registered with
 * `"world": "MAIN"` in manifest.json. It therefore has **no access to
 * `chrome.*`, to `window.Roll20A11y`, or to anything else the rest of the
 * extension sets up** — those live in the isolated world and are invisible from
 * here. Keep it self-contained.
 *
 * --- Why it has to be here and not in a content script -------------------
 *
 * Roll20 announces a new chat message with
 * `https://app.roll20.net/images/sounds/beep.ogg`, played through an `<audio>`
 * element it never inserts into the document — `new Audio(url).play()`. Both
 * halves of that matter:
 *
 *   - there is no element in the DOM to find and mute, so the isolated world
 *     has nothing to act on;
 *   - and an isolated-world script cannot patch `HTMLMediaElement.prototype`,
 *     because it has its own copy of every prototype.
 *
 * A `world: "MAIN"` script is the only way to get at the call. Verified on the
 * live VTT: `HTMLMediaElement.prototype.play` with
 * `src: .../images/sounds/beep.ogg`, `isConnected: false`.
 *
 * --- Why reading the DOM at play() time is sound -------------------------
 *
 * Roll20 **inserts the message before it plays the beep** — measured on the
 * live page, the two land in the same millisecond and the log's last message is
 * already the new one when `play()` is entered. So the newest message *is* the
 * one being announced, and there is no race to lose. If that order ever
 * reverses, the check reads the previous message and the beep is left alone,
 * which is the current behaviour and therefore a safe way to fail.
 *
 * Only this one URL is ever suppressed. Every other `play()` on the page — the
 * jukebox, video, the extension's own roll sounds — is passed straight through
 * untouched, so nothing else can be broken by this.
 */
(function () {
  "use strict";

  // The page world persists across soft navigations and this file could be
  // injected more than once; patching a patch would stack wrappers.
  if (window.__r20a11yBeepShim) return;
  window.__r20a11yBeepShim = true;

  const BEEP = "/images/sounds/beep.ogg";
  const SEL_MESSAGE = "#textchat .content > .message[data-messageid]";

  /**
   * Is the newest chat message a roll?
   *
   * Three shapes count, which between them cover every way a roll reaches the
   * log — a `/roll` typed into the chat box, a button on a character sheet, and
   * an inline `[[1d20]]` inside an ordinary message:
   *
   *   .rollresult        the message itself is a dice roll
   *   rolltemplate       a sheet roll
   *   .inlinerollresult  a roll embedded in a sentence
   *
   * Matching Roll20's own markup rather than searching the text for an "XdY"
   * pattern: the markup is what Roll20 actually decided, whereas the text of a
   * message someone typed by hand could contain "2d6" and is not a roll.
   */
  function lastMessageIsRoll() {
    const all = document.querySelectorAll(SEL_MESSAGE);
    const last = all[all.length - 1];
    if (!last) return false;
    return (
      last.classList.contains("rollresult") ||
      !!last.querySelector("rolltemplate, .inlinerollresult")
    );
  }

  const play = HTMLMediaElement.prototype.play;

  HTMLMediaElement.prototype.play = function () {
    try {
      const src = String(this.currentSrc || this.src || "");
      if (src.indexOf(BEEP) >= 0 && lastMessageIsRoll()) {
        // `play()` returns a promise and Roll20 may well be chaining off it, so
        // hand back a resolved one rather than nothing.
        return Promise.resolve();
      }
    } catch (e) {
      /* fall through and play it — never let this shim break page audio */
    }
    return play.apply(this, arguments);
  };
})();
