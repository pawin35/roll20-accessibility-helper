/**
 * Feature: keyboard shortcuts for the roll mode.
 *
 *   alt+A   Advantage
 *   alt+S   Automatic  (the standard roll)
 *   alt+Z   Disadvantage
 *
 * Roll20 puts these in a row of radios above the sheet. Reaching them means
 * leaving whatever you were doing, tabbing up to the group, arrowing to the one
 * you want, and then finding your way back — for a setting you change between
 * one roll and the next. The shortcuts set it from wherever you are.
 *
 * Focus is never moved. `click()` does not focus its target, so the radio is
 * selected exactly as if it had been chosen, and a screen reader stays put. The
 * outcome is spoken through the frame's own live region instead.
 *
 * The markup, established by probe (features/diagnostics.js, since deleted):
 *
 *   div.poly-radio.manage__roll-mode--radio   role=radiogroup
 *                                             data-selectedvalue="Advantage"
 *     div.poly-radio__button                  role=radio aria-checked=true
 *       div.poly-radio__button-label          "Advantage"
 *     … "Disadvantage", "Automatic", "Query"
 *
 * Two things worth keeping in mind:
 *
 *   - There are no `input[type="radio"]` elements anywhere on the sheet. These
 *     are Headless UI divs, so `checked` means `aria-checked`, and the group's
 *     `data-selectedvalue` is the authoritative current mode.
 *   - `manage__roll-privacy--radio` is a second, near-identical group holding
 *     Public and Whisper. Matching on `.poly-radio__button` alone would hit it,
 *     so everything here is scoped to the roll-mode group by class.
 *
 * Roll20 mounts *two* sheet iframes, one of them 0x0. Both run this file, and
 * the ghost has a full 0x0 copy of the group in it — so the frame bails out
 * entirely unless its own body has a size, and the top frame forwards to the
 * iframe that is actually visible rather than to the first one it finds.
 */
(function () {
  "use strict";

  const { debug, announce, normalize } = window.Roll20A11y;

  // The value Roll20 uses, keyed by physical key so a non-US layout works.
  const KEYS = {
    KeyA: "Advantage",
    KeyS: "Automatic",
    KeyZ: "Disadvantage",
  };

  // What to say. Roll20 calls the ordinary roll "Automatic", which describes
  // how it decides rather than what it does; "Normal" is what it means, and is
  // the word the rest of the extension already uses for it.
  const SPOKEN = {
    Advantage: "Advantage",
    Automatic: "Normal",
    Disadvantage: "Disadvantage",
  };

  const VALUES = Object.keys(KEYS).map((code) => KEYS[code]);

  const TOP_ORIGIN = "https://app.roll20.net";
  const SHEET_ORIGIN = "https://advanced-sheets.production.roll20preflight.net";

  function keyValue(event) {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return "";
    return KEYS[event.code] || "";
  }

  // --- Top frame -------------------------------------------------------
  //
  // The controls live in the sheet, but the shortcut has to work from anywhere
  // — including before focus has ever entered the frame, when a keydown is
  // delivered to this document and the sheet frame never sees it. So the key is
  // caught here too and the request forwarded down.
  //
  // The announcement is made in whichever frame the user is actually in, and
  // only there: two live regions saying the same thing is worse than one.

  if (window.top === window) {
    /** The visible sheet frame — never the 0x0 ghost Roll20 also mounts. */
    function sheetFrame() {
      const frames = document.querySelectorAll('iframe[src*="advanced-sheets"]');
      for (const frame of frames) {
        if (frame.offsetWidth || frame.offsetHeight) return frame;
      }
      return null;
    }

    // Where focus was when the key was pressed up here. Selecting the option
    // down in the sheet moves focus into the frame — focusing anything inside
    // an iframe focuses the iframe — so it has to be pulled back afterwards.
    let returnTo = null;

    document.addEventListener(
      "keydown",
      (event) => {
        const value = keyValue(event);
        if (!value) return;
        event.preventDefault();
        const frame = sheetFrame();
        if (!frame || !frame.contentWindow) {
          announce("Could not set " + SPOKEN[value] + ".");
          return;
        }
        returnTo = document.activeElement;
        try {
          frame.contentWindow.postMessage({ r20a11yRollMode: value }, SHEET_ORIGIN);
        } catch (e) {
          announce("Could not set " + SPOKEN[value] + ".");
        }
      },
      true
    );

    // The sheet frame reports back what actually happened; this frame speaks it
    // because this frame is where the user's focus is.
    window.addEventListener("message", (event) => {
      if (event.origin !== SHEET_ORIGIN) return;
      const said = event.data && event.data.r20a11yRollModeResult;
      if (typeof said !== "string") return;

      if (
        returnTo &&
        returnTo.isConnected &&
        returnTo !== document.body &&
        document.activeElement !== returnTo &&
        returnTo.focus
      ) {
        returnTo.focus();
      }
      returnTo = null;
      announce(said);
    });

    return;
  }

  // --- Sheet frame ------------------------------------------------------
  //
  // Roll20 mounts a second, 0x0 sheet iframe running this same file, with a
  // full 0x0 copy of the radio group inside it. Acting there would click a
  // control nobody can see and announce an outcome twice. A frame whose body
  // has no size is that ghost, and installs nothing at all.
  if (!document.body || (!document.body.offsetWidth && !document.body.offsetHeight)) {
    debug("rollmode", "ghost sheet frame, roll-mode keys not installed");
    return;
  }

  const SEL_GROUP = ".manage__roll-mode--radio";
  const SEL_OPTION = ".poly-radio__button";
  const SEL_OPTION_LABEL = ".poly-radio__button-label";
  const ATTR_SELECTED = "data-selectedvalue";

  /**
   * Activate `option` and leave focus where the user had it.
   *
   * These are Headless UI radio options, and Headless UI focuses the option as
   * part of handling a click — that is its roving-tabindex behaviour, not
   * something `click()` does on its own. The effect is that a shortcut meant to
   * change a setting in place instead dumps a screen reader on the radio group.
   *
   * Focus is captured first and put back afterwards. The restore is attempted
   * on this tick and twice more, because the focus may be moved synchronously
   * inside the click or on a later tick, and it stops as soon as focus is back
   * — so the settled case costs nothing.
   *
   * Removing the option's `tabindex` to make the focus a no-op was considered
   * and rejected: Headless UI uses it for keyboard navigation within the group,
   * and breaking that to fix this would trade one keyboard problem for another.
   */
  function clickWithoutStealingFocus(option) {
    const before = document.activeElement;
    option.click();

    const restore = () => {
      const now = document.activeElement;
      if (now === before) return;
      if (before && before.isConnected && before !== document.body && before.focus) {
        before.focus();
      } else if (now && now.blur) {
        // Nothing was focused to begin with, so returning to the body is
        // returning it to where it was.
        now.blur();
      }
    };

    restore();
    window.setTimeout(restore, 0);
    window.setTimeout(restore, 60);
  }

  /**
   * The roll-mode group, or null.
   *
   * Not cached: Vue re-renders the toolbar and a held reference goes stale.
   * Resolving costs one querySelectorAll on a keypress, which is nothing.
   */
  function findGroup() {
    const groups = document.querySelectorAll(SEL_GROUP);
    for (const candidate of groups) {
      if (candidate.offsetWidth || candidate.offsetHeight) return candidate;
    }
    return null;
  }

  function optionFor(group, value) {
    for (const option of group.querySelectorAll(SEL_OPTION)) {
      const label = option.querySelector(SEL_OPTION_LABEL);
      if (label && normalize(label.textContent) === value) return option;
    }
    return null;
  }

  /**
   * The currently selected value, or "" when the markup does not say.
   *
   * Taken from the group's own `data-selectedvalue`, which Roll20 keeps
   * up to date, with `aria-checked` on the options as a fallback.
   */
  function selectedValue(group) {
    const attr = group.getAttribute(ATTR_SELECTED);
    if (attr) return normalize(attr);
    for (const option of group.querySelectorAll(SEL_OPTION)) {
      if (option.getAttribute("aria-checked") !== "true") continue;
      const label = option.querySelector(SEL_OPTION_LABEL);
      if (label) return normalize(label.textContent);
    }
    return "";
  }

  /** `say` receives the outcome, so the caller decides which frame speaks. */
  function setMode(value, say) {
    const spoken = SPOKEN[value] || value;

    const group = findGroup();
    if (!group) {
      // Fail safe and say so, rather than leaving a pressed key unanswered.
      say("Could not set " + spoken + ".");
      debug("rollmode", "no visible roll-mode group");
      return;
    }

    const option = optionFor(group, value);
    if (!option) {
      say("Could not set " + spoken + ".");
      debug("rollmode", "no option labelled " + value);
      return;
    }

    // Headless UI focuses the option itself as part of handling the click —
    // `click()` alone is not enough to leave focus alone, which was the first
    // thing tried here. Put it back where it was.
    clickWithoutStealingFocus(option);

    // Read the result back rather than asserting it. Roll20 re-renders the
    // group on selection, so the group is looked up again rather than reused.
    window.setTimeout(() => {
      const after = findGroup();
      const now = after ? selectedValue(after) : "";
      if (now && now !== value) {
        say("Could not set " + spoken + ".");
        debug("rollmode", value + " did not take, still " + now);
        return;
      }
      say(spoken + ".");
      debug("rollmode", value + " set, confirmed: " + (now === value));
    }, 150);
  }

  document.addEventListener(
    "keydown",
    (event) => {
      const value = keyValue(event);
      if (!value) return;
      event.preventDefault();
      // Pressed in this frame, so this frame has focus and speaks.
      setMode(value, announce);
    },
    true
  );

  // Forwarded from the top frame, which has focus — so it speaks, not us.
  window.addEventListener("message", (event) => {
    if (event.origin !== TOP_ORIGIN) return;
    const value = event.data && event.data.r20a11yRollMode;
    if (typeof value !== "string" || VALUES.indexOf(value) < 0) return;
    setMode(value, (text) => {
      try {
        window.parent.postMessage({ r20a11yRollModeResult: text }, TOP_ORIGIN);
      } catch (e) {
        /* parent unreachable; the mode was still set */
      }
    });
  });
})();
