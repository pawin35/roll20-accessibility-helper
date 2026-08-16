/**
 * Feature: move and trap focus inside Roll20's dialogs.
 *
 * The panel editors are marked up correctly — they announce as dialogs — but
 * nothing moves focus into them when they open. A screen reader is left
 * wherever it was on the page behind, so the dialog is announced and then
 * apparently unreachable, and Tab keeps walking the page underneath it while
 * the dialog sits on top.
 *
 * Four things are needed, and none of them are about labelling:
 *
 *   - move focus in when it opens
 *   - keep Tab inside while it is open
 *   - catch focus when Vue destroys the control that had it
 *   - put focus back where it came from when it closes
 *
 * The third is the one that is easy to miss. Activating a control inside these
 * dialogs re-renders their contents, which destroys the focused element —
 * and Chrome responds by dropping focus to `document.body`, silently. The
 * dialog is still open and still on screen, but a screen reader is now outside
 * it at the top of the page, and every activation costs the user a manual
 * re-entry. Only recovery from a genuine *loss* is done here; focus moved
 * deliberately elsewhere is left alone, because that is how closing works.
 *
 * Roll20's own close handling is left alone; this only manages focus.
 */
(function () {
  "use strict";

  const { debug, enhance, markOnce } = window.Roll20A11y;

  const SEL_DIALOG = '[role="dialog"], [role="alertdialog"]';

  const FOCUSABLE = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled]):not([type=hidden])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
  ].join(", ");

  const CLOSE_POLL_MS = 250;

  function focusables(dialog) {
    return Array.prototype.filter.call(
      dialog.querySelectorAll(FOCUSABLE),
      // Zero-sized elements are either hidden or not yet laid out; focusing
      // one of those is how focus silently disappears.
      (el) => el.offsetWidth > 0 || el.offsetHeight > 0
    );
  }

  enhance(SEL_DIALOG, (dialog) => {
    if (!markOnce(dialog, "dialog-focus")) return;
    // Vue mounts these before they are laid out, so a dialog can match while
    // still being invisible. Only manage ones that are actually showing.
    if (!dialog.offsetWidth && !dialog.offsetHeight) return;

    const returnTo = document.activeElement;

    if (!dialog.hasAttribute("aria-modal")) {
      dialog.setAttribute("aria-modal", "true");
    }
    // Always focusable, not only when it has no controls: focus recovery falls
    // back to the container whenever the dialog's contents have been swapped
    // for something different.
    if (!dialog.hasAttribute("tabindex")) dialog.setAttribute("tabindex", "-1");

    // Focus the first control, or the dialog itself if it has none.
    const first = focusables(dialog)[0];
    (first || dialog).focus();

    // --- Focus recovery --------------------------------------------------

    let lastIndex = 0;
    let lastCount = focusables(dialog).length;

    dialog.addEventListener("focusin", () => {
      const items = focusables(dialog);
      const index = items.indexOf(document.activeElement);
      if (index < 0) return;
      lastIndex = index;
      lastCount = items.length;
    });

    function isOpen() {
      return dialog.isConnected && (dialog.offsetWidth || dialog.offsetHeight);
    }

    function recover() {
      if (!isOpen()) return;

      // Only step in when focus was *lost*. Anything else — including focus
      // moved into a dialog opened on top of this one — is deliberate.
      const active = document.activeElement;
      if (active && active !== document.body && active !== document.documentElement) {
        return;
      }

      // If another dialog is open above this one, recovering here would steal
      // focus from it.
      const open = Array.prototype.filter.call(
        document.querySelectorAll(SEL_DIALOG),
        (el) => el.offsetWidth > 0 || el.offsetHeight > 0
      );
      if (open.length && open[open.length - 1] !== dialog) return;

      const items = focusables(dialog);
      if (!items.length) {
        dialog.focus();
        return;
      }

      // A changed control count means the dialog swapped views rather than
      // re-rendering the same one, so the old position is meaningless — focus
      // the container instead and let the screen reader read the new content
      // from its start. Otherwise put focus back where it was.
      if (items.length !== lastCount) dialog.focus();
      else items[Math.min(lastIndex, items.length - 1)].focus();
    }

    // Chrome does not reliably fire blur or focusout when the focused element
    // is *removed*, so this cannot rely on an event alone. focusout covers the
    // cases it does fire for; the close poll below is the backstop that catches
    // the rest. setTimeout(0) lets the re-render settle before we look.
    dialog.addEventListener("focusout", () => window.setTimeout(recover, 0));

    function onKeydown(event) {
      if (event.key !== "Tab") return;
      const items = focusables(dialog);
      if (!items.length) return;

      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const active = document.activeElement;

      // Wrap at both ends, and pull focus back in if it has already escaped.
      if (event.shiftKey && (active === firstItem || !dialog.contains(active))) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && (active === lastItem || !dialog.contains(active))) {
        event.preventDefault();
        firstItem.focus();
      }
    }

    dialog.addEventListener("keydown", onKeydown);
    // Also on the document, so a Tab pressed after focus has escaped the
    // dialog still gets pulled back rather than walking the page behind it.
    document.addEventListener("keydown", onKeydown, true);

    // setTimeout rather than requestAnimationFrame: rAF is paused entirely
    // while the tab is backgrounded, which would leave the trap installed.
    const poll = () => {
      if (isOpen()) {
        // Doubles as the backstop for focus recovery — a focused element that
        // Vue removes may never fire an event at all.
        recover();
        window.setTimeout(poll, CLOSE_POLL_MS);
        return;
      }
      document.removeEventListener("keydown", onKeydown, true);
      dialog.removeEventListener("keydown", onKeydown);
      // Returning focus matters as much as moving it: without this, closing a
      // dialog drops focus to the document body and a screen reader restarts
      // from the top of the sheet.
      if (returnTo && returnTo.isConnected) returnTo.focus();
    };
    window.setTimeout(poll, CLOSE_POLL_MS);

    debug("dialog", "focus moved into a dialog and trapped");
  });
})();
