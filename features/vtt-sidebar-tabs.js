/**
 * Feature: reaching the VTT sidebar's tabs.
 *
 *   alt+shift+1 … alt+shift+9   switch to that tab and put focus in its panel
 *
 * Two separate problems, both in `#rightsidebar`, which is a jQuery UI tabs
 * widget (not Vue — this is the old VTT code, and it does not re-render itself
 * the way the character sheet does).
 *
 * 1. The tabs are misnamed. Roll20's markup is very nearly right: the `<li>`
 *    carries `role="tab"`, `title="Chat"`, `aria-controls`, `aria-selected`,
 *    and a roving `tabindex`. But it also carries `aria-labelledby` pointing at
 *    the `<a>` inside it, and that `<a>`'s text is the **icon font's glyph
 *    name** — "chatTab", "assetsTab", "journalTab". `aria-labelledby` beats
 *    `title`, so every tab announces as its glyph. Dropping the reference and
 *    naming from Roll20's own `title` fixes it without authoring any text.
 *
 * 2. Getting there at all. Even correctly named, the tablist is a long way into
 *    the tab order of a page this size, and it is the thing you want most
 *    often. The shortcut goes straight there.
 *
 * The visible tab set is not fixed — two of the eight carry an inline `display`
 * style and Roll20 shows or hides them by campaign and role — so the index is
 * resolved against the tabs that are actually on screen at the moment the key
 * is pressed, and the announcement names the tab it landed on rather than
 * assuming you know which number is which.
 */
(function () {
  "use strict";

  const { debug, announce, normalize } = window.Roll20A11y;

  const TOP_ORIGIN = "https://app.roll20.net";
  const SHEET_ORIGIN = "https://advanced-sheets.production.roll20preflight.net";

  /** 1-9 for alt+shift+<n>, or 0 when this is not our key. */
  function tabIndex(event) {
    // `event.code` rather than `event.key`: with alt+shift held, `key` is a
    // symbol on most layouts, and this has to work on a non-US keyboard.
    if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return 0;
    const match = /^Digit([1-9])$/.exec(event.code || "");
    return match ? Number(match[1]) : 0;
  }

  // --- Sheet frame ------------------------------------------------------
  //
  // The floating character sheet is a cross-origin iframe, and while focus is
  // inside it the keydown never reaches the VTT document at all. Forward it.
  //
  // On the character-sheet page there is no sidebar and no listener up there;
  // the post simply goes nowhere, which is why this needs no page check.

  if (window.top !== window) {
    document.addEventListener(
      "keydown",
      (event) => {
        const n = tabIndex(event);
        if (!n) return;
        event.preventDefault();
        try {
          window.parent.postMessage({ r20a11yVttTab: n }, TOP_ORIGIN);
        } catch (e) {
          /* parent unreachable; nothing else this frame can do */
        }
      },
      true
    );

    // Only failures come back: on success focus has moved up into the panel, so
    // the top frame is where the user now is and the top frame speaks.
    window.addEventListener("message", (event) => {
      if (event.origin !== TOP_ORIGIN) return;
      const said = event.data && event.data.r20a11yVttTabResult;
      if (typeof said === "string") announce(said);
    });

    return;
  }

  // --- Top frame --------------------------------------------------------

  const SEL_NAV = "#rightsidebar > ul.tabmenu";
  const SEL_TAB = 'li[role="tab"]';

  // jQuery UI rewrites the nav's classes and tabindexes whenever a tab changes,
  // and Roll20 shows and hides tabs after load. A sweep with an idempotent
  // repair covers both without having to predict which write lands when — the
  // same reasoning as `features/combobox-labels.js`. Every branch checks before
  // it writes, so a pass with nothing to do mutates nothing at all: a redundant
  // attribute write is something a screen reader can react to.
  const SWEEP_MS = 500;

  function tabs() {
    const nav = document.querySelector(SEL_NAV);
    return nav ? Array.prototype.slice.call(nav.querySelectorAll(SEL_TAB)) : [];
  }

  /** Only the tabs actually on screen — Roll20 hides some by campaign/role. */
  function visibleTabs() {
    return tabs().filter((li) => li.offsetWidth || li.offsetHeight);
  }

  /** Roll20's own name for a tab. Never authored here, so it cannot go stale. */
  function nameOf(li) {
    return normalize(li.getAttribute("title"));
  }

  function repair() {
    for (const li of tabs()) {
      const name = nameOf(li);
      if (!name) continue;

      // The reference to the glyph `<a>` is the whole bug; `title` is only
      // consulted once nothing else supplies a name.
      if (li.hasAttribute("aria-labelledby")) li.removeAttribute("aria-labelledby");
      if (li.getAttribute("aria-label") !== name) li.setAttribute("aria-label", name);

      // The glyph text is still sitting in the tab's content. It no longer
      // names anything, but it is read in browse mode until it is hidden.
      const link = li.querySelector("a");
      if (link && link.getAttribute("aria-hidden") !== "true") {
        link.setAttribute("aria-hidden", "true");
      }
    }
  }

  function sweep() {
    repair();
    window.setTimeout(sweep, SWEEP_MS);
  }

  /**
   * The panel a tab controls, once it has actually been shown.
   *
   * jQuery UI swaps panels synchronously, but the animation means the new one
   * can still measure 0x0 on the tick after the click, and focusing something
   * with no box is unreliable. Polled with setTimeout, never rAF: rAF is paused
   * entirely while the tab is backgrounded and the poll would hang.
   */
  function whenPanelShown(li, done) {
    const id = li.getAttribute("aria-controls");
    const startedAt = Date.now();

    const tick = () => {
      const panel = id ? document.getElementById(id) : null;
      if (panel && (panel.offsetWidth || panel.offsetHeight)) return done(panel);
      if (Date.now() - startedAt > 1500) return done(null);
      window.setTimeout(tick, 32);
    };
    tick();
  }

  /** `say` receives failures only; success is announced here — see below. */
  function activate(n, say) {
    const found = visibleTabs();
    if (n > found.length) {
      say("No tab " + n + ".");
      debug("vtttabs", "asked for tab " + n + " of " + found.length);
      return;
    }

    const li = found[n - 1];
    const name = nameOf(li) || "Tab " + n;

    // The click goes on the `<a>`: that is what jQuery UI binds its handler to,
    // and clicking the `li` does not switch the panel.
    (li.querySelector("a") || li).click();

    whenPanelShown(li, (panel) => {
      if (!panel) {
        say("Could not open " + name + ".");
        debug("vtttabs", "panel for " + name + " never appeared");
        return;
      }
      // Not focusable on its own — Roll20's panels are plain divs.
      if (!panel.hasAttribute("tabindex")) panel.setAttribute("tabindex", "-1");
      panel.focus();
      // Focus is in this frame now, whichever frame the key came from, so this
      // frame speaks. `say` is only used for the paths where focus never moved.
      announce(name + " tab.");
      debug("vtttabs", "opened " + name);
    });
  }

  document.addEventListener(
    "keydown",
    (event) => {
      const n = tabIndex(event);
      if (!n) return;
      event.preventDefault();
      activate(n, announce);
    },
    true
  );

  // Forwarded from the sheet frame. A failure leaves focus down there, so the
  // message goes back for it to speak; a success moves focus up here and is
  // announced by `activate` instead.
  window.addEventListener("message", (event) => {
    if (event.origin !== SHEET_ORIGIN) return;
    const n = event.data && event.data.r20a11yVttTab;
    if (typeof n !== "number" || !(n >= 1 && n <= 9)) return;
    const source = event.source;
    activate(n, (text) => {
      try {
        source.postMessage({ r20a11yVttTabResult: text }, SHEET_ORIGIN);
      } catch (e) {
        /* frame unreachable; nothing was opened either way */
      }
    });
  });

  sweep();
})();
