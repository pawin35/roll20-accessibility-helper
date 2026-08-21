/**
 * Cutting off the screen reader while focus goes back.
 *
 * Closing a dialog hands focus to the control that opened it, and NVDA answers
 * by reading that control *and* everything it sits inside — "Ability scores,
 * table with 7 rows and 5 columns, Roll Strength +1 saving throw, button" —
 * over the top of the roll the user is waiting for.
 *
 * Nothing on the web side gets in front of that. Parking focus, deferring the
 * hand-back, an assertive live region, and a whole dialog in a separate Windows
 * process were all tried; see "What was tried and did not work" in CLAUDE.md.
 * What works is asking NVDA to stop talking, through its controller API — and
 * that needs a Windows process, hence `native/` and `background.js`.
 *
 * **Windows-and-NVDA-only, and entirely optional.** No host installed, another
 * platform, NVDA not running, the registry key removed — every one of those
 * ends in `silence()` doing nothing and `available()` resolving false, and the
 * extension behaves exactly as it did before any of this existed. Nothing here
 * ever throws into a feature.
 */
(function () {
  "use strict";

  const { debug } = window.Roll20A11y;

  /**
   * How long NVDA is held quiet *after* focus returns, and equally how long the
   * roll is held back before being sent. Fixed: it is a property of how long a
   * focus announcement takes to queue and how fast Roll20 answers, not of the
   * machine.
   */
  const TAIL_MS = 450;

  /**
   * The floor, ceiling and margin for the lead — how long before focus moves
   * the request goes out.
   *
   * Cancelling that begins after the announcement is already queued lets the
   * first syllable out, so the request is fired first and the focus move waits
   * behind it. The lead therefore has to cover the round trip to the host.
   *
   * It is **not** a constant, because it is not a property of this code: it
   * depends on the machine and on how the host was built. So it is measured
   * (see `probe`) rather than guessed at, and an install on someone else's PC
   * tunes itself instead of inheriting a number from this one. Too short is the
   * bad direction — the chatter gets a word out — so the margin is generous.
   *
   * The floor is low because `background.js` holds the native port open: a
   * warm request is a pipe write, not a process launch. It was 150 when every
   * request started a fresh process.
   */
  const LEAD_MIN_MS = 60;
  const LEAD_MAX_MS = 500;
  const LEAD_MARGIN_MS = 60;

  let leadMs = LEAD_MIN_MS;

  const PROBE_MS = 3000;

  /** Promise<boolean>, resolved once and reused. */
  let probed = null;

  // The synchronous shadow of `probed`, because the places that have to decide
  // whether to wait — closing a dialog, sending a roll — are not async and
  // should not become async for this. False until the probe answers, so the
  // first moments after load simply behave as if there were no silencer.
  let ready = false;

  /**
   * The extension messaging API, or null where there is none to speak of.
   * Checked rather than assumed: this file loads on every platform the
   * extension runs on, and only Windows has anything at the other end.
   */
  const messaging =
    typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage
      ? chrome.runtime
      : null;

  function send(payload, timeoutMs) {
    if (!messaging) return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      if (timeoutMs) window.setTimeout(() => finish(null), timeoutMs);

      try {
        messaging.sendMessage({ r20a11yNative: payload }, (response) => {
          if (messaging.lastError || !response || response.error) {
            return finish(null);
          }
          finish(response.reply);
        });
      } catch (e) {
        // Most often an extension context invalidated by a reload without a
        // page refresh, which makes sendMessage throw rather than call back.
        finish(null);
      }
    });
  }

  /**
   * Is there a silencer, and is NVDA running? Asked once per frame and cached;
   * `background.js` caches it again across frames, so this costs one process
   * launch per service-worker lifetime rather than one per frame.
   */
  /**
   * Ask twice, deliberately.
   *
   * The first ping is what opens the native port, so it pays for the host
   * process starting and says nothing about what a request costs afterwards.
   * The second travels a port that is already open — the same thing a dialog
   * close will do — so that is the one the lead is sized from. Measuring the
   * first would size the lead for a cost that is only ever paid once.
   */
  function probe() {
    return send({ type: "ping" }, PROBE_MS).then((first) => {
      if (!(first && first.ok && first.nvda)) {
        debug("nvdasilence", first ? "host present, NVDA not running" : "no host");
        return false;
      }

      const started = Date.now();
      return send({ type: "ping" }, PROBE_MS).then((second) => {
        ready = true;
        // A failed second ping is not a reason to give up — the host answered
        // once. Fall back to the ceiling, which is the safe direction.
        const warm = second ? Date.now() - started : LEAD_MAX_MS;
        leadMs = Math.min(
          LEAD_MAX_MS,
          Math.max(LEAD_MIN_MS, warm + LEAD_MARGIN_MS)
        );
        debug(
          "nvdasilence",
          "host " + first.version + " cold:" + first.startupMs +
            " warm:" + warm + " lead:" + leadMs + " via " + first.helper
        );
        return true;
      });
    });
  }

  function available() {
    if (!probed) probed = probe();
    return probed;
  }

  /**
   * Ask NVDA to go quiet. Fire-and-forget: the caller does not wait, because
   * the whole point is to be already cancelling by the time focus moves.
   * Harmless when there is no host.
   *
   * The host counts `ms` from when *it* starts, which is `startupMs` after this
   * call — so asking for `TAIL_MS` covers the window from focus returning until
   * the roll is sent, and stops before the result could arrive and be cancelled
   * with the chatter.
   */
  function silence() {
    send({ type: "silence", ms: TAIL_MS });
  }

  /** The current lead, sized from what the host reported it cost to start. */
  function lead() {
    return leadMs;
  }

  /** Sync: is silencing going to do anything if we ask? */
  function enabled() {
    return ready;
  }

  window.Roll20A11y.nvdaSilence = { available, enabled, silence, lead, TAIL_MS };

  // Warm the answer up, so `enabled()` is truthful by the time a dialog closes
  // — and so the port is already open by then.
  //
  // Not in the ghost frame, though. Roll20 mounts *two* sheet iframes and one
  // of them is 0x0; it runs every sheet content script but can never open a
  // dialog, so a probe from it is two round trips that can only ever be thrown
  // away. Same body-size test the other sheet features use.
  const ghost =
    window.top !== window &&
    (!document.body || (!document.body.offsetWidth && !document.body.offsetHeight));

  if (ghost) {
    debug("nvdasilence", "ghost sheet frame, not probing");
  } else {
    available();
  }
})();
