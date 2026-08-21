/**
 * A modal list of choices, shared by the roll shortcuts.
 *
 * A native `<dialog>.showModal()` is what "aria modal" asks for: the platform
 * exposes it with role="dialog" and aria-modal, makes the rest of the page
 * inert (which is the focus trap), and fires `cancel` on Escape.
 *
 * The control inside is an ARIA listbox, not a `<select>`. A native select
 * cannot give the wanted reading: in Chrome a collapsed one commits the new
 * value on the very first Down arrow, and the `showPicker()` workaround opens a
 * popup a screen reader cannot read. A listbox announces every option as focus
 * moves through it, and commits only on Enter, Space, or a click.
 *
 * Extracted from features/roll-shortcuts.js so features/attack-shortcuts.js can
 * use the same dialog. Only one modal is ever open at a time, and the singleton
 * below is built lazily, so this file costs nothing in a frame that never opens
 * one (the sheet frame, where both features only forward the key upward).
 */
(function () {
  "use strict";

  const { CLASS_PREFIX } = window.Roll20A11y;

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

  let dialog = null;
  let titleEl = null;
  let labelEl = null;
  let listbox = null;
  let options = [];
  let activeIndex = 0;
  let lastFocus = null;
  let onCommit = null;
  let onClose = null;

  function build() {
    if (dialog) return;
    dialog = document.createElement("dialog");
    dialog.className = CLASS_PREFIX + "-modal";

    titleEl = document.createElement("h2");
    // These two ids are load-bearing: styles.css keys off #r20a11y-roll-label.
    titleEl.id = CLASS_PREFIX + "-roll-title";
    dialog.setAttribute("aria-labelledby", titleEl.id);
    dialog.appendChild(titleEl);

    labelEl = document.createElement("span");
    labelEl.id = CLASS_PREFIX + "-roll-label";

    listbox = document.createElement("div");
    listbox.setAttribute("role", "listbox");
    listbox.setAttribute("aria-labelledby", labelEl.id);

    dialog.appendChild(labelEl);
    dialog.appendChild(listbox);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = CLASS_PREFIX + "-btn";
    closeBtn.textContent = "Close";
    dialog.appendChild(closeBtn);

    document.body.appendChild(dialog);

    // Escape on a modal dialog fires `cancel`; the default would close the
    // dialog without our cleanup, so it is stopped and closed here instead.
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close(false, "");
    });

    listbox.addEventListener("keydown", (event) => {
      const key = event.key;
      if (key === "ArrowDown") {
        event.preventDefault();
        setActive(activeIndex + 1);
      } else if (key === "ArrowUp") {
        event.preventDefault();
        setActive(activeIndex - 1);
      } else if (key === "Home") {
        event.preventDefault();
        setActive(0);
      } else if (key === "End") {
        event.preventDefault();
        setActive(options.length - 1);
      } else if (key === "Enter" || key === " ") {
        event.preventDefault();
        commit();
      }
    });

    listbox.addEventListener("click", (event) => {
      const opt =
        event.target && event.target.closest
          ? event.target.closest('[role="option"]')
          : null;
      if (!opt) return;
      const i = options.indexOf(opt);
      if (i >= 0) setActive(i);
      commit();
    });

    closeBtn.addEventListener("click", () => close(false, ""));

    // Escape closes in one press, wherever focus sits inside the dialog. At the
    // document (capture) level so it also fires ahead of the listbox's own
    // keydown handler and any focus-mode key handling the screen reader does
    // before handing the key to the page. The dialog's native `cancel` event
    // remains as a fallback for browsers that close on Escape themselves.
    document.addEventListener(
      "keydown",
      (event) => {
        if (!dialog || !dialog.open) return;
        if (event.key !== "Escape") return;
        event.preventDefault();
        close(false, "");
      },
      true
    );
  }

  /**
   * Move the active option to `i`, keeping a roving tabindex: exactly one
   * option is a tab stop at a time. Focusing the option is what reads it.
   */
  function setActive(i) {
    if (!options.length || i < 0 || i >= options.length) return;
    if (activeIndex >= 0 && activeIndex < options.length && options[activeIndex]) {
      options[activeIndex].setAttribute("tabindex", "-1");
      options[activeIndex].setAttribute("aria-selected", "false");
    }
    activeIndex = i;
    options[i].setAttribute("tabindex", "0");
    options[i].setAttribute("aria-selected", "true");
    options[i].focus();
  }

  function commit() {
    if (activeIndex < 0 || activeIndex >= options.length) return;
    close(true, options[activeIndex].dataset.value);
  }

  // True across the lead below, when the dialog is still open but already
  // committed. Without it a second Enter or Escape in that window would run
  // the whole close a second time.
  let closing = false;

  /**
   * Close, but ask NVDA to go quiet first.
   *
   * `dialog.close()` restores focus to the control that opened the dialog, and
   * the screen reader answers by reading that control and everything it sits
   * inside — over the top of the roll. Firing the request *before* the close
   * and letting the close wait `LEAD_MS` behind it means the cancelling is
   * already running when there is something to cancel; starting it afterwards
   * lets the first syllable out while the host process starts.
   *
   * No silencer — another platform, no NVDA — and this is the plain close it
   * always was.
   */
  function close(committed, value) {
    if (!dialog || !dialog.open || closing) return;
    if (!silencer.enabled()) return finishClose(committed, value);

    closing = true;
    silencer.silence();
    window.setTimeout(() => {
      closing = false;
      finishClose(committed, value);
    }, silencer.lead());
  }

  function finishClose(committed, value) {
    if (!dialog || !dialog.open) return;
    dialog.close();

    const commitCb = onCommit;
    const closeCb = onClose;
    const returnTo = lastFocus;
    onCommit = null;
    onClose = null;
    lastFocus = null;

    if (committed && commitCb) commitCb(value, returnTo);

    // The dialog's own restore has already put focus back on whatever opened
    // it. `onClose` still gets `returnTo` so the caller can confirm it, and is
    // where the speech that follows gets cut short.
    if (closeCb) closeCb(committed, returnTo);
  }

  function isOpen() {
    return !!(dialog && dialog.open);
  }

  /**
   * Open the modal over `items` (`[{display, value}]`). `onCommit(value,
   * returnTo)` runs when one is chosen; `onClose(committed, returnTo)` runs
   * afterwards either way, and is responsible for putting focus back — the
   * modal parks it and leaves it parked. Returns false when it could not open.
   *
   * `focusBefore` is the element focus should return to. Callers whose key was
   * forwarded from the sheet frame must capture it at keypress time, before any
   * round trip, or it will already have moved.
   */
  function open(config) {
    build();
    if (dialog.open) return false;

    const items = config.items || [];
    if (!items.length) return false;

    titleEl.textContent = config.title || "";
    labelEl.textContent = config.label || "";
    listbox.textContent = "";
    options = [];

    items.forEach((item, i) => {
      const opt = document.createElement("div");
      opt.setAttribute("role", "option");
      // The first option is the tab stop, and carries `autofocus` besides.
      // Chrome's dialog focusing steps focus the <dialog> element itself unless
      // something inside asks for focus outright — so without this, showModal
      // announced the dialog, and our own focus() announced it all over again
      // before the first option's name. setActive moves the roving tabindex.
      opt.setAttribute("tabindex", i === 0 ? "0" : "-1");
      if (i === 0) opt.setAttribute("autofocus", "");
      opt.setAttribute("aria-selected", i === 0 ? "true" : "false");
      opt.textContent = item.display;
      opt.dataset.value = item.value;
      listbox.appendChild(opt);
      options.push(opt);
    });
    activeIndex = 0;

    onCommit = config.onCommit || null;
    onClose = config.onClose || null;
    lastFocus =
      config.focusBefore !== undefined ? config.focusBefore : document.activeElement;

    // Focus is deliberately left where it is. `showModal()` records it as the
    // element to restore to on close, and now that the dialog opens in the same
    // frame as the control that opened it, that is exactly right — the control
    // gets focus straight back — at the cost of the screen reader reading that
    // control and its surroundings before the result is spoken.
    dialog.showModal();
    // `autofocus` above should have landed here already; this is the fallback
    // for a browser whose focusing steps ignore it. Guarded, because focusing
    // an option that already has focus is a second event and reads as a second
    // dialog.
    if (document.activeElement !== options[0]) options[0].focus();
    return true;
  }

  window.Roll20A11y.choiceModal = { open, close, isOpen };
})();
