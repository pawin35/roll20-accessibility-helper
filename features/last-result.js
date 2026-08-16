/**
 * Feature: speak roll results without leaving the sheet.
 *
 * Activating any roll control makes Roll20 open its Roll Log drawer. That
 * drawer is a `role="dialog"` with `aria-modal="true"` that takes focus the
 * moment it opens — `document.activeElement` becomes `.el-drawer__sr-focus`
 * inside it — and the modal flag hides the entire rest of the page from a
 * screen reader. So every roll throws the user out of the sheet and into a
 * history list, where the result they actually wanted is the last of N entries.
 *
 * This reads the new entry and puts the text in a live region of our own at the
 * end of the page. Focus is never moved.
 *
 * The drawer is dealt with by *hiding* it, not by closing it. Three approaches
 * were tried against the live page and only the third leaves focus alone:
 *
 *   close it after it opens   Element Plus restores focus to the <iframe>
 *                             element, and a screen reader re-enters the sheet
 *                             from the top of the page. This is worse than
 *                             doing nothing — it was the first thing built here
 *                             and it is why the drawer is no longer closed.
 *
 *   remove the trap's         The trap simply falls through to the next
 *   `tabindex`                focusable thing, so focus lands on the close
 *                             button instead. Verified, not speculation.
 *
 *   `display: none`           A hidden element cannot be focused, so the trap
 *                             is a no-op. Roll20 still opens the drawer, still
 *                             renders the roll into it, and focus never leaves
 *                             the sheet — and closing it afterwards is then
 *                             harmless, because a restore onto an element that
 *                             already has focus fires no event.
 *
 * The hiding must not be written onto the drawer element. A class put there
 * survives exactly one roll: Vue rewrites `className` when it re-renders the
 * drawer on open and close, after which the next roll flashes it open and steals
 * focus again. The stylesheet keys off `<html>` and Roll20's own `data-testid`
 * instead, so nothing has to survive anywhere.
 *
 * Two things about where this runs:
 *
 *   top frame    The Roll Log lives here, not in the sheet iframe — so unlike
 *                most of this extension it is ordinary, scriptable, inspectable
 *                DOM. Everything below happens here.
 *
 *   sheet frame  Focus is normally inside the iframe, so alt+O is delivered to
 *                *that* document and a top-frame listener never sees it. The
 *                sheet frame's only job is to forward the key up to the parent.
 *
 * Why entries and not roll buttons: roll controls are spread over five
 * unrelated selector families (skills, abilities, attacks, spells, initiative),
 * and every one of them lands here as a `.chat-container[data-messageid]`.
 * Watching the results covers all of them at once, including any Roll20 adds
 * later. Do not add a per-button interception path.
 */
(function () {
  "use strict";

  const { CLASS_PREFIX, debug, enhance, markOnce, rollFormat } = window.Roll20A11y;
  // The `rolltemplate` itself is read by lib/roll-format.js, because the VTT's
  // text chat renders the identical template inside a different wrapper. Only
  // the wrapper and the dice tray are this file's business.
  const { normalize, textOf, describeTemplate, judge, critKindFromTemplate } = rollFormat;

  const TOP_ORIGIN = "https://app.roll20.net";
  const SHEET_ORIGIN = "https://advanced-sheets.production.roll20preflight.net";

  /** alt+O, checked by physical key so a non-US layout still works. */
  function isReadKey(event) {
    if (!event.altKey || event.ctrlKey || event.metaKey) return false;
    if (event.code === "KeyO") return true;
    return (event.key || "").toLowerCase() === "o";
  }

  /**
   * Sounds, addressed by key rather than by path.
   *
   * The top frame asks for one of these by name over postMessage. Looking the
   * key up here means a message can only ever select a sound this file already
   * knows about, never name a file of its own.
   */
  const SOUNDS = {
    roll: "sounds/roll.mp3",
    crit: "sounds/natural-20.mp3",
    fail: "sounds/natural-1.mp3",
  };

  /**
   * Roll controls, for the rolling sound only.
   *
   * Capturing results does not use this list and must never start to — it works
   * off the roll log precisely so that an unknown roll button is still spoken.
   * The stakes here are much lower: a control missing from this list means one
   * silent second, not a lost result. Kept scoped to attack and spell rows so a
   * click on the HP panel's Damage button is not mistaken for a damage roll.
   */
  const SEL_ROLL_CONTROLS = [
    ".skill__name",
    'button[data-testid="initiative-button"]',
    ".inline-ability__badges--mod .poly-button__button",
    ".inline-ability__badges--save .poly-button__button",
    ".attack-item .poly-button--hit-dc",
    ".attack-item .poly-button--damage",
    ".attack-item .poly-button--heal",
    ".attack-item .poly-button--healing",
    ".spell-item .poly-button--hit-dc",
    ".spell-item .poly-button--damage",
    ".spell-item .poly-button--heal",
    ".spell-item .poly-button--healing",
  ].join(", ");

  // --- Sheet frame: the rolling sound, and forwarding the hotkey --------

  if (window.top !== window) {
    // A roll takes about a second to come back. The sound fills that gap, so
    // pressing a roll button is not answered by silence.
    //
    // It plays from *this* frame on purpose. The click that starts the roll
    // happens here, so Chrome sees a genuine user activation; the same call
    // made from the parent a moment later, out of a MutationObserver, has no
    // gesture behind it and is liable to be blocked by the autoplay policy.
    // Sounds are queued, never layered: the roll sound has to finish before a
    // crit or fumble sound starts, so the two are heard as two events rather
    // than as one muddle.
    const queue = [];
    let playing = false;
    // A cap, so hammering a roll button cannot build a backlog that is still
    // draining long after the rolls are over.
    const MAX_QUEUE = 3;

    function playNext() {
      const key = queue.shift();
      if (!key) {
        playing = false;
        return;
      }
      playing = true;
      let advanced = false;
      // `ended`, `error` and a rejected play() can fire in combination; the
      // queue must move on exactly once whichever of them happens.
      const advance = () => {
        if (advanced) return;
        advanced = true;
        playNext();
      };
      try {
        const audio = new Audio(chrome.runtime.getURL(SOUNDS[key]));
        audio.addEventListener("ended", advance);
        audio.addEventListener("error", advance);
        const played = audio.play();
        if (played && played.catch) {
          played.catch((error) => {
            debug("lastresult", "sound " + key + " blocked: " + (error && error.name));
            advance();
          });
        }
      } catch (error) {
        // A missing file or a blocked load must never take the announcement
        // down with it.
        debug("lastresult", "sound " + key + " failed: " + (error && error.message));
        advance();
      }
    }

    function play(key) {
      if (!SOUNDS[key]) return;
      if (queue.length >= MAX_QUEUE) return;
      queue.push(key);
      if (!playing) playNext();
    }

    document.addEventListener(
      "click",
      (event) => {
        const target = event.target;
        if (target && target.closest && target.closest(SEL_ROLL_CONTROLS)) {
          play("roll");
        }
      },
      true
    );

    // The crit and fumble sounds are asked for from the top frame, which is
    // where the result lands. They are played from here rather than there
    // because this frame has the user's click behind it.
    window.addEventListener("message", (event) => {
      if (event.origin !== TOP_ORIGIN) return;
      const key = event.data && event.data.r20a11ySound;
      if (typeof key === "string") play(key);
    });

    document.addEventListener(
      "keydown",
      (event) => {
        if (!isReadKey(event)) return;
        event.preventDefault();
        try {
          window.parent.postMessage({ r20a11yReannounce: true }, TOP_ORIGIN);
        } catch (e) {
          /* parent unreachable; nothing else this frame can do */
        }
      },
      true
    );
    return;
  }

  // --- Top frame -------------------------------------------------------

  const SEL_DRAWER = '[data-testid="test-roll-log-drawer"]';
  const SEL_CLOSE = ".el-drawer__close-btn";
  const SEL_LOG_BUTTON = "button.roll-log-button";
  // On <html>, never on the drawer: Vue rewrites the drawer's className on
  // every open and close, so anything written there is gone by the next roll.
  const VISIBLE_CLASS = CLASS_PREFIX + "-roll-log-visible";
  const SEL_ENTRY = ".chat-container[data-messageid]";
  // The entry body only. The whole `.chat-container` also holds the avatar
  // initials and the timestamp, which read as "BLBrother Lorian11:49 AM".
  const SEL_BODY = ".chat-container__message";

  const HEADING_ID = CLASS_PREFIX + "-last-result-heading";
  const REGION_ID = CLASS_PREFIX + "-last-result";

  const EMPTY_TEXT = "No result yet.";
  const FAILURE_TEXT = "Roll result could not be read.";

  // Collect entries that arrive together before speaking, so an attack and its
  // damage are not two interruptions.
  const SETTLE_MS = 150;
  // Longer when a crit or fumble sound has just been asked for, so the sound
  // lands before the speech instead of underneath it. "One after another"
  // applies to the sound and the announcement, not only to the two sounds.
  const CRIT_SETTLE_MS = 900;
  // Entries further apart than this are a new burst, and start a fresh box.
  const BURST_MS = 700;
  const POLL_MS = 500;
  // How long to wait for a deliberately-opened drawer to actually appear before
  // giving up and hiding it again.
  const OPEN_TIMEOUT_MS = 5000;

  // --- The box ---------------------------------------------------------

  let region = null;

  function buildRegion() {
    const section = document.createElement("section");
    section.className = CLASS_PREFIX + "-visually-hidden";
    section.setAttribute("aria-labelledby", HEADING_ID);

    const heading = document.createElement("h2");
    heading.id = HEADING_ID;
    heading.textContent = "Last Result";
    section.appendChild(heading);

    const live = document.createElement("div");
    live.id = REGION_ID;
    live.setAttribute("role", "status");
    live.setAttribute("aria-live", "polite");
    // `role="status"` implies aria-atomic="true", which would re-read every
    // line each time one is appended. We want only the new line spoken.
    live.setAttribute("aria-atomic", "false");
    live.setAttribute("aria-relevant", "additions text");
    live.textContent = EMPTY_TEXT;
    section.appendChild(live);

    // Populated before insertion: a live region only reports changes made
    // after it is in the document, so the placeholder is never announced.
    document.body.appendChild(section);
    return live;
  }

  function getRegion() {
    if (region && region.isConnected) return region;
    region = buildRegion();
    return region;
  }

  /** The lines currently in the box, so alt+O can rebuild them verbatim. */
  let lines = [];

  function renderLine(text) {
    const p = document.createElement("p");
    p.textContent = text;
    getRegion().appendChild(p);
  }

  function addLine(text) {
    lines.push(text);
    renderLine(text);
  }

  function startBurst() {
    // Removals are not announced under `aria-relevant="additions text"`, so
    // clearing the box — including the placeholder — is silent.
    getRegion().textContent = "";
    lines = [];
  }

  function reannounce() {
    const box = getRegion();
    const previous = lines.slice();
    box.textContent = "";
    // setTimeout rather than requestAnimationFrame: rAF is paused entirely
    // while the tab is backgrounded, which would swallow the message. Clearing
    // first is what makes an identical message get announced a second time —
    // same reasoning as `announce()` in lib/core.js.
    window.setTimeout(() => {
      if (!previous.length) {
        box.textContent = EMPTY_TEXT;
        return;
      }
      for (const line of previous) renderLine(line);
    }, 0);
  }

  // --- Reading an entry -------------------------------------------------

  /**
   * The dice tray's own rolls, which are a different shape entirely: no
   * `rolltemplate`, no bonus list, no title. Read as raw text they come out as
   * "(20)1d2020" — the total, the formula and the die run together with no
   * separators at all.
   *
   * Formatted the same way as a sheet roll, minus the title it does not have:
   *
   *   "1d20, 20. Total 20."
   */
  function readDiceTray(root) {
    const main = root.querySelector(".roll-result__main");
    if (!main) return "";

    const formula = textOf(main, ".roll-result__formula");
    const dice = Array.prototype.map.call(
      main.querySelectorAll(".roll-result__results .roll"),
      (die) => normalize(die.textContent)
    );
    const total = textOf(main, ".roll-result__total-number");

    const parts = [formula].concat(dice).filter(Boolean);
    if (!parts.length && !total) return "";
    const body = parts.join(", ");
    if (!total) return body + ".";
    return body ? body + ". Total " + total + "." : "Total " + total + ".";
  }

  /**
   * Returns what to say for an entry, or "" if there was nothing to read.
   *
   * The roll template itself is `describeTemplate` in lib/roll-format.js; this
   * only picks the entry's body out of its wrapper and handles the dice tray,
   * which is a shape the VTT does not have. `describeTemplate` returning ""
   * means it did not recognise the card, not that the card was empty, so the
   * raw text is read instead.
   *
   * `SEL_NOISE` is stripped here as well as inside `describeTemplate` because
   * the fallback path reads `clone.textContent` for the whole body, and the
   * character name would otherwise be spoken on every single roll.
   */
  const SEL_NOISE = ".meta, summary, .bonus-list__header";

  function readEntry(entry) {
    const body = entry.querySelector(SEL_BODY) || entry;
    const clone = body.cloneNode(true);
    clone.querySelectorAll(SEL_NOISE).forEach((node) => node.remove());

    const template = clone.querySelector("rolltemplate");
    if (!template) return readDiceTray(clone) || normalize(clone.textContent);
    return describeTemplate(template) || normalize(clone.textContent);
  }

  // --- Natural 20s and natural 1s ---------------------------------------

  function critKind(entry) {
    const template = entry.querySelector("rolltemplate");
    if (template) return critKindFromTemplate(template);

    // Dice tray. Roll20 also marks a natural maximum with a `max` class on the
    // die, but the value is checked instead so that both shapes go through one
    // rule — and because `max` on a d6 is not a crit.
    const main = entry.querySelector(".roll-result__main");
    if (!main) return "";
    const dice = Array.prototype.map.call(
      main.querySelectorAll(".roll-result__results .roll"),
      (die) => normalize(die.textContent)
    );
    return judge(textOf(main, ".roll-result__formula"), dice);
  }

  function requestSound(key) {
    const frame = document.querySelector('iframe[src*="advanced-sheets"]');
    if (!frame || !frame.contentWindow) return;
    try {
      frame.contentWindow.postMessage({ r20a11ySound: key }, SHEET_ORIGIN);
      debug("lastresult", "asked the sheet frame to play " + key);
    } catch (e) {
      /* frame unreachable; the roll is still announced */
    }
  }

  // --- The drawer -------------------------------------------------------

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (typeof el.checkVisibility === "function") {
      return el.checkVisibility({ checkVisibilityCSS: true });
    }
    return el.offsetParent !== null;
  }

  // The drawer is hidden by default and only revealed while the user has asked
  // for it from the nav. It is never closed programmatically — see the note at
  // the top of this file for why closing is the thing that breaks focus.
  let userOpened = false;
  let sawOpen = false;
  let openedAt = 0;
  let reopening = false;

  /**
   * Hide the drawer and strip its modal flag. Idempotent — every write is
   * guarded, so a pass with nothing to do mutates nothing at all. A redundant
   * attribute write is a DOM change a screen reader can react to.
   *
   * The hiding itself is done by the stylesheet, keyed on a class on <html> and
   * on Roll20's own `data-testid`, so nothing has to survive on the drawer.
   * That matters: Vue rewrites the drawer's className whenever it re-renders,
   * which it does on every open and close.
   *
   * Removing `aria-modal` is belt and braces. If the hide ever failed — a
   * Roll20 markup change, a renamed testid — the modal flag alone would blank
   * the entire rest of the page for a screen reader, including the box below.
   * Nothing inside a hidden drawer is reachable, so it has nothing to be modal
   * about. This one does have to be re-applied by the sweep, since it is an
   * attribute on the element Vue owns.
   */
  function neutralise(drawer) {
    const root = document.documentElement;
    if (root.classList.contains(VISIBLE_CLASS)) root.classList.remove(VISIBLE_CLASS);
    const el = drawer || document.querySelector(SEL_DRAWER);
    if (el && el.getAttribute("aria-modal") === "true") {
      el.removeAttribute("aria-modal");
    }
  }

  function revealDrawer() {
    document.documentElement.classList.add(VISIBLE_CLASS);
    return document.querySelector(SEL_DRAWER);
  }

  // `aria-modal` is deliberately not put back when the user opens the log by
  // hand: Element Plus still traps Tab inside it, and leaving the rest of the
  // page readable in browse mode is the friendlier failure if they get stuck.

  enhance(SEL_DRAWER, (drawer) => {
    if (userOpened) return;
    neutralise(drawer);
    debug("lastresult", "roll log neutralised");
  });

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!target || !target.closest || !target.closest(SEL_LOG_BUTTON)) return;

      // Our own re-open click below, not the user's.
      if (reopening) {
        reopening = false;
        return;
      }

      userOpened = true;
      sawOpen = false;
      openedAt = Date.now();
      revealDrawer();
      debug("lastresult", "roll log opened from the nav; revealing it");

      // A roll may already have put Roll20's own state into "open" while the
      // drawer was hidden, in which case this click just toggled it shut. One
      // re-open puts that right; `reopening` stops it recurring.
      window.setTimeout(() => {
        if (!userOpened || sawOpen || isVisible(document.querySelector(SEL_DRAWER))) return;
        const button = document.querySelector(SEL_LOG_BUTTON);
        if (!button) return;
        reopening = true;
        button.click();
        debug("lastresult", "roll log state was already open; re-opened it");
      }, 400);
    },
    true
  );

  // setTimeout chain rather than setInterval, and never requestAnimationFrame:
  // rAF does not run at all while the tab is backgrounded.
  (function pollDrawer() {
    const drawer = document.querySelector(SEL_DRAWER);
    if (!userOpened) {
      // Vue owns this element and re-renders it freely, so the class and the
      // attribute are re-applied rather than assumed to have survived.
      neutralise(drawer);
    } else if (isVisible(drawer)) {
      sawOpen = true;
    } else if (sawOpen || Date.now() - openedAt > OPEN_TIMEOUT_MS) {
      // Either the user closed it again, or it never appeared. Either way it
      // goes back to being hidden so the next roll cannot steal focus.
      userOpened = false;
      sawOpen = false;
      neutralise(drawer);
      debug("lastresult", "roll log hidden again");
    }
    window.setTimeout(pollDrawer, POLL_MS);
  })();

  /**
   * Put Roll20's own state back to "closed" after a roll opened it.
   *
   * This is only safe *because* the drawer is hidden. Element Plus restores
   * focus to whatever had it when the drawer opened — the <iframe> — and since
   * a hidden drawer never took focus in the first place, that restore lands on
   * an element that already has focus and therefore fires no focus event at
   * all. Closing a *visible* drawer is what threw the screen reader back to the
   * top of the page.
   */
  function closeDrawerIfOurs() {
    if (userOpened) return;
    const drawer = document.querySelector(SEL_DRAWER);
    if (!drawer) return;
    // The drawer is display:none, so its own visibility says nothing about
    // Roll20's state. The transition wrapper around it is what tracks that.
    const wrapper = drawer.parentElement;
    if (!wrapper || window.getComputedStyle(wrapper).display === "none") return;
    const close = drawer.querySelector(SEL_CLOSE);
    if (!close) {
      debug("lastresult", "roll log has no close button; leaving its state open");
      return;
    }
    close.click();
    debug("lastresult", "closed the roll log");
  }

  // --- Wiring -----------------------------------------------------------

  const pending = [];
  let flushTimer = null;
  let lastFlushAt = 0;

  function flush() {
    flushTimer = null;
    const now = Date.now();
    if (now - lastFlushAt > BURST_MS) startBurst();
    lastFlushAt = now;
    while (pending.length) addLine(pending.shift());
  }

  function handle(entry) {
    const text = readEntry(entry) || FAILURE_TEXT;
    const crit = critKind(entry);

    pending.push(text);
    closeDrawerIfOurs();
    if (crit) {
      requestSound(crit);
      // A short flush may already be scheduled from an earlier entry in this
      // burst; push it back so the sound is not spoken over.
      if (flushTimer !== null) {
        window.clearTimeout(flushTimer);
        flushTimer = null;
      }
    }
    if (flushTimer === null) {
      flushTimer = window.setTimeout(flush, crit ? CRIT_SETTLE_MS : SETTLE_MS);
    }
    debug("lastresult", "captured a result: " + text.slice(0, 80));
  }

  // The drawer's body does not exist until the drawer first opens, so the whole
  // history mounts in one burst. Announcing all of it — and slamming the drawer
  // shut on someone who just opened it to read — is the obvious wrong move.
  //
  // But the first roll of a session ALSO mounts the list, and that one must be
  // announced, so "everything present on first sight is history" is too blunt.
  // What separates the two cases is *why* the list mounted, which `userOpened`
  // already knows.
  let primed = false;

  function prime() {
    primed = true;
    const all = Array.prototype.slice.call(document.querySelectorAll(SEL_ENTRY));
    // Opened by hand: all history. Opened by a roll: everything but the newest
    // is history, and the newest is the roll that caused it.
    const keep = userOpened ? null : all[all.length - 1];
    for (const entry of all) {
      if (entry !== keep) markOnce(entry, "last-result");
    }
    debug(
      "lastresult",
      "primed " + all.length + " existing entries, keeping " + (keep ? "1" : "0")
    );
  }

  enhance(SEL_ENTRY, (entry) => {
    if (!primed) prime();
    if (!markOnce(entry, "last-result")) return;
    handle(entry);
  });

  document.addEventListener(
    "keydown",
    (event) => {
      if (!isReadKey(event)) return;
      event.preventDefault();
      reannounce();
    },
    true
  );

  window.addEventListener("message", (event) => {
    if (event.origin !== SHEET_ORIGIN) return;
    if (event.data && event.data.r20a11yReannounce) reannounce();
  });

  // Build the box up front, so the heading is there to navigate to and reads
  // "No result yet." before anything has been rolled.
  getRegion();
})();
