/**
 * Opening a chooser in the frame the user is actually in.
 *
 * The VTT top frame is where a roll is sent from and where its result arrives,
 * but when a shortcut is pressed inside the floating character sheet, that is
 * not where the user is. Opening the dialog up there means focus crosses the
 * iframe boundary twice, and a screen reader charges for both crossings:
 *
 *     out of table  out of frame  same page link  Skip to the chat tab  blank
 *     …
 *     Character sheet for Tempis  frame  Ability scores  table with 7 rows…
 *
 * None of that is suppressible — it is what leaving and re-entering a document
 * costs. So the dialog is built in whichever frame pressed the key: the top
 * frame decides *what* is in the list, posts it down, and gets a choice back.
 * Focus never leaves the sheet, and the roll result is routed down to be spoken
 * there too (`claimNextAnnouncement` in lib/core.js).
 *
 * This module owns the focus dance for both features, so there is one copy of
 * it. See "Focus and the dialogs" in CLAUDE.md for why focus is parked before
 * the dialog opens and why the hand-back waits.
 */
(function () {
  "use strict";

  const { announce, choiceModal, claimNextAnnouncement } = window.Roll20A11y;

  // The silencer is optional: Windows + NVDA only, and it may not have loaded
  // at all. Everything here has to work without it, so a stand-in that says
  // "no" is substituted rather than reaching for it directly - a missing one
  // would otherwise throw from inside close(), and a dialog that cannot close
  // is far worse than a noisy one.
  const silencer = window.Roll20A11y.nvdaSilence || {
    enabled: () => false,
    silence: () => {},
    lead: () => 0,
    TAIL_MS: 0,
  };

  const TOP_ORIGIN = "https://app.roll20.net";
  const SHEET_ORIGIN = "https://advanced-sheets.production.roll20preflight.net";

  function restore(element) {
    if (
      element &&
      element.isConnected &&
      element.focus &&
      document.activeElement !== element
    ) {
      element.focus();
    }
  }

  /**
   * Open the dialog in *this* document. `afterCommit(value)` runs when an
   * option is chosen.
   *
   * `document.activeElement` is captured here rather than at the keypress: the
   * key only travels to the other frame and back, and nothing has moved focus
   * in between, so it still holds the control the user came from.
   */
  function openHere(config, afterCommit) {
    const returnTo = document.activeElement;
    return choiceModal.open({
      title: config.title,
      label: config.label,
      items: config.items,
      focusBefore: returnTo,
      onCommit: afterCommit,
      onClose: (committed, back) => {
        // Focus goes back at once — the dialog's own restore has usually done
        // it already; this confirms it. The result then queues behind whatever
        // the screen reader says about the control receiving focus, which is
        // the cost this path has and nothing so far has removed.
        restore(back);
      },
    });
  }

  // --- Sheet frame ------------------------------------------------------

  if (window.top !== window) {
    window.addEventListener("message", (event) => {
      if (event.origin !== TOP_ORIGIN) return;
      const data = event.data || {};

      const request = data.r20a11yModalOpen;
      if (request) {
        const reply = (value) => {
          try {
            window.parent.postMessage(
              { r20a11yModalChoice: { id: request.id, value } },
              TOP_ORIGIN
            );
          } catch (e) {
            /* parent unreachable; nothing else this frame can do */
          }
        };
        // A null choice tells the top frame to forget the request rather than
        // leave it waiting forever for a dialog that never opened.
        if (!openHere(request, reply)) reply(null);
        return;
      }

      if (data.r20a11yModalFail) announce(data.r20a11yModalFail);
    });
    return;
  }

  // --- VTT top frame ----------------------------------------------------

  /**
   * Send the roll, but not into the silence.
   *
   * `lib/choice-modal.js` has NVDA held quiet across the moment focus goes
   * back. The result of the roll has to land *after* that, or it is cancelled
   * along with the chatter — which is the one way to get this exactly
   * backwards, and it looks like the silencer simply not working. So the send
   * waits out what is left of the window; Roll20's own round trip then puts the
   * result comfortably clear of it.
   */
  function afterSilence(run) {
    if (!silencer.enabled()) return run();
    window.setTimeout(run, silencer.TAIL_MS);
  }

  let seq = 0;
  const waiting = {};

  window.addEventListener("message", (event) => {
    if (event.origin !== SHEET_ORIGIN) return;
    const choice = event.data && event.data.r20a11yModalChoice;
    if (!choice) return;
    const entry = waiting[choice.id];
    if (!entry) return;
    delete waiting[choice.id];
    if (choice.value === null || choice.value === undefined) return;
    // The result lands in this frame's chat log; claim it so it is delivered
    // to the frame holding focus rather than spoken up here, where the user
    // is not.
    afterSilence(() => {
      claimNextAnnouncement(entry.frame);
      entry.onCommit(choice.value);
    });
  });

  /**
   * Open a chooser in `frame`, or in this document when `frame` is null.
   * `onCommit(value)` always runs here, in the top frame, because that is where
   * chat can be sent from.
   */
  function open(config) {
    const frame = config.frame;
    if (!frame) {
      // Opened here, so the result is claimed here.
      return openHere(config, (value) => {
        afterSilence(() => {
          claimNextAnnouncement(null);
          config.onCommit(value);
        });
      });
    }

    const id = "m" + ++seq;
    waiting[id] = { onCommit: config.onCommit, frame };
    try {
      frame.postMessage(
        {
          r20a11yModalOpen: {
            id,
            title: config.title,
            label: config.label,
            items: config.items,
          },
        },
        SHEET_ORIGIN
      );
      return true;
    } catch (e) {
      delete waiting[id];
      return false;
    }
  }

  /** Speak a failure in `frame`, or here when the key was pressed here. */
  function fail(frame, say) {
    if (!frame) return announce(say);
    try {
      frame.postMessage({ r20a11yModalFail: say }, SHEET_ORIGIN);
    } catch (e) {
      announce(say);
    }
  }

  window.Roll20A11y.remoteModal = { open, fail };
})();
