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
        // it already; this confirms it. The result then arrives assertively,
        // which is what carries it over the context a screen reader reads out
        // around the control.
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
    // to the frame holding focus, and assertively, so it cuts through whatever
    // is being said there.
    claimNextAnnouncement(entry.frame);
    entry.onCommit(choice.value);
  });

  /**
   * Open a chooser in `frame`, or in this document when `frame` is null.
   * `onCommit(value)` always runs here, in the top frame, because that is where
   * chat can be sent from.
   */
  function open(config) {
    const frame = config.frame;
    if (!frame) {
      // Opened here, so the result is claimed here — still assertively, so it
      // cuts through the context spoken when focus returns to the control.
      return openHere(config, (value) => {
        claimNextAnnouncement(null);
        config.onCommit(value);
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
