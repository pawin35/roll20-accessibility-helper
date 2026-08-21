/**
 * `alt+H` — adjust hit points on a slider.
 *
 * The slider opens at the character's current HP and runs from 0 to their
 * maximum. Arrow keys move it a point at a time, Page Up/Down ten, Home and End
 * jump to the ends, Enter commits, Escape closes without changing anything.
 * Committing writes the new value and announces the change to the table:
 *
 *     Tempis: takes 3 damage, current HP is 9
 *     Tempis: heals 4 hit points, current HP is 12
 *
 * A slider rather than a number box because the interesting question is "how
 * much of my health is left", which is a position on a scale; and because a
 * screen reader reads a range control's value on every keypress, so the number
 * is spoken as you move rather than only once you stop.
 *
 * `alt+shift+H` is the read-only twin: it speaks HP and AC and changes nothing.
 *
 * Same three-part split as the other shortcuts — see features/roll-shortcuts.js.
 * The dialog opens in whichever frame pressed the key; the write and the chat
 * send happen in the VTT top frame, which is the only place that can do either.
 */
(function () {
  "use strict";

  const {
    announce,
    choiceModal,
    currentCharacterName,
    debug,
    remoteModal,
    requestCharacter,
    setCharacterHp,
    claimNextAnnouncement,
  } = window.Roll20A11y;

  // `sendChatText` is published by features/vtt-chat.js and read at call time,
  // not destructured here: it only exists in the VTT top frame, and only once
  // that file has run.

  const TOP_ORIGIN = "https://app.roll20.net";
  const SHEET_ORIGIN = "https://advanced-sheets.production.roll20preflight.net";

  function isHpKey(event) {
    return (
      event.altKey &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      event.code === "KeyH"
    );
  }

  // --- Sheet frame ------------------------------------------------------

  if (window.top !== window) {
    let returnTo = null;

    window.addEventListener("keydown", (event) => {
      if (!isHpKey(event)) return;
      event.preventDefault();
      event.stopPropagation();
      returnTo = document.activeElement;
      try {
        window.parent.postMessage({ r20a11yHpShortcut: true }, TOP_ORIGIN);
      } catch (e) {
        announce("Could not reach the game window.");
      }
    }, true);

    window.addEventListener("message", (event) => {
      if (event.origin !== TOP_ORIGIN) return;
      if (!event.data || !event.data.r20a11yHpShortcutDone) return;
      // The dialog opened here, so its own restore has usually run already;
      // this confirms it for the paths where no dialog opened at all.
      if (returnTo && returnTo.isConnected && document.activeElement !== returnTo) {
        returnTo.focus();
      }
      returnTo = null;
    });
    return;
  }

  // --- VTT top frame ----------------------------------------------------

  /** Tell the sheet frame it may take focus back. Harmless when it cannot. */
  function replyDone(frame) {
    if (!frame) return;
    try {
      frame.postMessage({ r20a11yHpShortcutDone: true }, SHEET_ORIGIN);
    } catch (e) {
      /* frame unreachable; nothing to restore anyway */
    }
  }

  /**
   * Current and maximum hit points.
   *
   * `custom_meta1` is the only place a maximum exists — the store holds hit
   * dice and a pile of bonuses, never the total — while the store holds the
   * live current value. Prefer the store for current, since it is what the
   * setter writes first.
   */
  function hitPoints(data) {
    const meta = (data && data.meta) || {};
    const hp = meta.hp || {};
    const store = (data && data.hitpoints) || {};

    const current =
      typeof store.currentHP === "number"
        ? store.currentHP
        : typeof hp.current === "number"
        ? hp.current
        : null;
    const max = typeof hp.max === "number" ? hp.max : null;
    return { current, max };
  }

  /**
   * The top of the slider.
   *
   * Normally the character's maximum. Without one — a sheet whose meta has not
   * been written yet — a slider still has to have a top, and one that cannot
   * reach above the current value would be a healing control that cannot heal.
   * Room to climb is the safer guess.
   */
  function ceiling(current, max) {
    if (typeof max === "number" && max > 0) return max;
    return Math.max(10, current * 2);
  }

  function plural(n, one, many) {
    return n === 1 ? one : many;
  }

  /** "takes 3 damage, current HP is 9" — the line sent to chat. */
  function describeChange(from, to) {
    const delta = to - from;
    if (delta < 0) {
      const n = -delta;
      return "takes " + n + " damage, current HP is " + to;
    }
    return (
      "heals " + delta + " " + plural(delta, "hit point", "hit points") +
      ", current HP is " + to
    );
  }

  let busy = false;

  function openHpSlider(frame) {
    const name = currentCharacterName();
    if (!name) {
      remoteModal.fail(frame, "You have no character to adjust.");
      return Promise.resolve();
    }

    return requestCharacter(name).then((data) => {
      if (!data || data.error || !data.integrants) {
        remoteModal.fail(frame, "Could not read your character's hit points.");
        return;
      }

      const { current, max } = hitPoints(data);
      if (typeof current !== "number") {
        remoteModal.fail(frame, "Could not read your character's hit points.");
        return;
      }

      const rollAs = data.name || name;
      const top = ceiling(current, max);
      debug("hp", rollAs + " at " + current + " of " + top);

      remoteModal.openSlider({
        frame,
        title: "Adjust hit points",
        label:
          "Hit points for " + rollAs + ", currently " + current + " of " + top,
        min: 0,
        max: top,
        value: current,
        onCommit: (value) => commitHp(frame, rollAs, current, Number(value)),
      });
    });
  }

  /**
   * Write the new value, then say what changed.
   *
   * The chat line is sent *after* the write lands and reports what the model
   * actually holds, not what the slider asked for — the setter clamps at zero,
   * and telling the table a number the sheet disagrees with is worse than
   * saying nothing.
   */
  function commitHp(frame, name, before, wanted) {
    if (!(wanted >= 0)) return replyDone(frame);
    if (wanted === before) {
      remoteModal.fail(frame, "Hit points unchanged.");
      return;
    }

    setCharacterHp(name, wanted).then((result) => {
      if (!result || !result.ok) {
        const why =
          result && result.error === "no-relay"
            ? "The character sheet is not ready yet."
            : "Could not change your hit points.";
        remoteModal.fail(frame, why);
        return;
      }

      const after = typeof result.current === "number" ? result.current : wanted;
      if (after === before) {
        remoteModal.fail(frame, "Hit points unchanged.");
        return;
      }

      // Sent as the character, so the log reads "Tempis: takes 3 damage…".
      // The line comes back through the chat log and is announced from there,
      // which is why nothing is announced here — see `sendChatText`'s empty
      // success message elsewhere.
      claimNextAnnouncement(frame || null);
      window.Roll20A11y.sendChatText(describeChange(before, after), null, "");
      replyDone(frame);
    });
  }

  function start(frame) {
    if (busy || choiceModal.isOpen()) {
      remoteModal.fail(frame, "Still opening the previous list.");
      return;
    }
    busy = true;
    openHpSlider(frame).then(
      () => {
        busy = false;
      },
      () => {
        busy = false;
        remoteModal.fail(frame, "Could not adjust your hit points.");
      }
    );
  }

  window.addEventListener("keydown", (event) => {
    if (!isHpKey(event)) return;
    event.preventDefault();
    start(null);
  }, true);

  window.addEventListener("message", (event) => {
    if (event.origin !== SHEET_ORIGIN) return;
    if (!event.data || !event.data.r20a11yHpShortcut) return;
    start(event.source);
  });
})();
