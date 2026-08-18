/**
 * Roll20 Accessibility Helper — shared core.
 *
 * All content scripts from this extension run in the same isolated world and
 * share one global scope, so this file just publishes helpers on
 * `window.Roll20A11y` for the feature scripts loaded after it (see the order
 * of `content_scripts.js` in manifest.json).
 */
(function () {
  "use strict";

  const CLASS_PREFIX = "r20a11y";

  // --- Screen-reader announcements ------------------------------------
  //
  // Roll20 shows its own visual toasts, but they are not reliably announced.
  // We keep a visually-hidden polite live region of our own so every action
  // this extension performs has a spoken result.

  let liveRegion = null;

  function getLiveRegion() {
    if (liveRegion && liveRegion.isConnected) return liveRegion;
    liveRegion = document.createElement("div");
    liveRegion.setAttribute("aria-live", "polite");
    liveRegion.setAttribute("role", "status");
    liveRegion.className = CLASS_PREFIX + "-live-region";
    document.body.appendChild(liveRegion);
    return liveRegion;
  }

  let announceToggle = false;

  function announce(message) {
    const region = getLiveRegion();
    // Clear first so repeating an identical message still gets announced.
    region.textContent = "";
    // Clearing is not enough on its own. Chrome batches accessibility updates,
    // so emptying the region and putting the *same* string back within one
    // frame can net out to no change at all and never be spoken. The symptom
    // was a shortcut that stayed silent when pressed twice in a row, but spoke
    // as soon as a different mode was chosen. A trailing no-break space on
    // alternate calls makes the text genuinely different each time; screen
    // readers do not voice it.
    announceToggle = !announceToggle;
    const text = announceToggle ? message + "\u00a0" : message;
    // setTimeout rather than requestAnimationFrame: rAF is paused entirely
    // while the tab is in the background, which would swallow the message.
    window.setTimeout(() => {
      region.textContent = text;
    }, 0);
  }

  // --- Waiting for asynchronously-rendered elements --------------------
  //
  // Roll20's UI is Vue-based and renders asynchronously, so an element is
  // frequently not in the DOM on the tick that you ask for it.
  //
  // Always poll with setTimeout, never requestAnimationFrame: rAF does not
  // run at all while the tab is backgrounded, so an rAF poll would hang
  // instead of timing out.

  function waitForElement(selector, { timeout = 2000, interval = 16 } = {}) {
    return new Promise((resolve) => {
      const immediate = document.querySelector(selector);
      if (immediate) return resolve(immediate);

      const startedAt = Date.now();
      const tick = () => {
        const found = document.querySelector(selector);
        if (found) return resolve(found);
        if (Date.now() - startedAt > timeout) return resolve(null);
        window.setTimeout(tick, interval);
      };
      window.setTimeout(tick, interval);
    });
  }

  // --- Reacting to nodes the app adds later ----------------------------
  //
  // Search results, panels and rows appear long after page load, so features
  // register a selector and get called once per matching element.

  const enhancers = [];
  let observing = false;

  function runEnhancer(enhancer, root) {
    if (root.nodeType === Node.ELEMENT_NODE && root.matches(enhancer.selector)) {
      enhancer.onMatch(root);
    }
    if (root.querySelectorAll) {
      // Wrap rather than passing onMatch straight to forEach — otherwise every
      // handler also receives (index, nodeList) as its 2nd and 3rd arguments.
      root.querySelectorAll(enhancer.selector).forEach((el) => enhancer.onMatch(el));
    }
  }

  function startObserving() {
    if (observing) return;
    observing = true;
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          for (const enhancer of enhancers) runEnhancer(enhancer, node);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  /**
   * Call `onMatch(element)` for every current and future element matching
   * `selector`. `onMatch` must be idempotent — guard with `markOnce`.
   */
  function enhance(selector, onMatch) {
    const enhancer = { selector, onMatch };
    enhancers.push(enhancer);
    runEnhancer(enhancer, document);
    startObserving();
  }

  /**
   * Returns true the first time it is called for a given element and key,
   * false afterwards, so an element is only ever enhanced once.
   */
  function markOnce(element, key) {
    const attr = "data-" + CLASS_PREFIX + "-" + key;
    if (element.hasAttribute(attr)) return false;
    element.setAttribute(attr, "1");
    return true;
  }

  // --- Accessible naming over Roll20's own live nodes -------------------
  //
  // We must never author the *value* text of a name. `markOnce` means an
  // aria-label we write is written once, so if a score or proficiency later
  // changes, Vue patches its text node and our label keeps reading the old
  // number. A confidently-wrong value is worse than no value.
  //
  // Instead we point `aria-labelledby` at the nodes Roll20 itself keeps
  // updated. The browser recomputes the name from live DOM on every read, so
  // it cannot go stale, and no observers or sync code are needed.

  let idCounter = 0;

  /** Returns the element's id, assigning a generated one if it has none. */
  function ensureId(element) {
    if (!element.id) element.id = CLASS_PREFIX + "-id-" + ++idCounter;
    return element.id;
  }

  /**
   * A span holding text for screen readers only. Absolutely positioned so it
   * takes no layout space — several of Roll20's panels are CSS grid/subgrid
   * and an in-flow element would shift their columns.
   */
  function hiddenSpan(text) {
    const span = document.createElement("span");
    span.className = CLASS_PREFIX + "-visually-hidden";
    span.textContent = text;
    return span;
  }

  /**
   * Names `element` from `parts`, a mix of live elements and literal strings.
   * Strings become hidden spans appended to `element`; elements contribute
   * whatever text they currently hold.
   *
   * `parts` may include `element` itself, which resolves to its own content —
   * that is how context gets prepended to a button reading only "+1" without
   * us ever owning the number.
   *
   * Parts that are missing (null) are skipped, so a caller can pass an element
   * that only exists in some states without branching.
   *
   * `host` is where the generated hidden spans are parked. It defaults to
   * `element`, but any caller that puts `element` in its own `parts` MUST pass
   * something else — otherwise the connective words get appended inside the
   * very element whose content the self-reference reads back, and each one
   * lands in the name twice. Park them on the row instead; the spans are
   * absolutely positioned, so they cost no layout wherever they go.
   */
  function labelFrom(element, parts, host) {
    const ids = [];
    for (const part of parts) {
      if (!part) continue;
      if (typeof part === "string") {
        const span = hiddenSpan(part);
        // These spans exist only to be *referenced*. Without aria-hidden they
        // are also read as loose text wherever they are parked — inside a
        // table row that means connective words like "roll check" and
        // "saving throw" get announced as if they were cell content. A node
        // referenced directly by aria-labelledby still contributes its text
        // even when hidden, so the name is unaffected.
        span.setAttribute("aria-hidden", "true");
        (host || element).appendChild(span);
        ids.push(ensureId(span));
      } else {
        ids.push(ensureId(part));
      }
    }
    if (!ids.length) return;
    element.setAttribute("aria-labelledby", ids.join(" "));
    // aria-labelledby wins over any name-from-content, but a leftover
    // aria-label would win over *it*, so clear one if Roll20 set it.
    element.removeAttribute("aria-label");
  }

  /**
   * Pins a cell to a specific column, 1-based.
   *
   * Without this, a screen reader infers a cell's column from its position
   * among its siblings — so a row that is missing an optional cell has every
   * later cell attributed to the wrong header. Roll20's rows do that
   * routinely: an attack with no type has no subtitle element, and a collapsed
   * skill drops its ability and bonus entirely.
   *
   * `aria-colindex` states the column outright, so a missing cell leaves a gap
   * instead of shifting everything after it.
   */
  function setColumn(element, index) {
    if (element) element.setAttribute("aria-colindex", String(index));
  }

  /**
   * Hides `element` from the accessibility tree as a container while leaving
   * its descendants in place. Needed to bridge wrapper divs that would
   * otherwise sit illegally between a `table` and its `row`s.
   */
  function presentational(element) {
    if (element) element.setAttribute("role", "none");
  }

  /** Creates a button styled and labelled consistently across features. */
  function createButton({ label, ariaLabel, onActivate }) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = CLASS_PREFIX + "-btn";
    btn.textContent = label;
    if (ariaLabel) btn.setAttribute("aria-label", ariaLabel);
    // Never let our button start a drag or trigger the row's own handlers.
    btn.addEventListener("dragstart", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onActivate(btn);
    });
    return btn;
  }

  // --- Shared utilities ---------------------------------------------------

  /** Collapse whitespace and trim. */
  function normalize(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  let sharedAudio = null;

  /**
   * Lazily create and resume an AudioContext. Each consumer stores the returned
   * instance in its own variable so that separate audio paths stay independent.
   */
  function primeAudio() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      if (!sharedAudio) sharedAudio = new Ctx();
      if (sharedAudio.state === "suspended") sharedAudio.resume();
      return sharedAudio;
    } catch (e) {
      /* no audio available */
      return null;
    }
  }

  /** alt+O, matched on `event.code` so a non-US layout still works. */
  function isReadKey(event) {
    if (!event.altKey || event.ctrlKey || event.metaKey) return false;
    if (event.code === "KeyO") return true;
    return (event.key || "").toLowerCase() === "o";
  }

  // --- "Table ready" signal ----------------------------------------------
  //
  // Features call `markReady("chat")` / `markReady("grid")` /
  // `markReady("speaking")` when they are up; once all three have reported, one
  // chime and one spoken "Table ready." announce that the page is safe to
  // drive. This is what stops a user pressing a shortcut before the VTT has
  // finished loading. It is inert anywhere else: only the VTT top frame ever
  // sets these flags.

  const readyFlags = { chat: false, grid: false, speaking: false };
  let readyDone = false;

  function readyChime() {
    const audio = primeAudio();
    if (!audio || audio.state !== "running") return;
    try {
      const now = audio.currentTime;
      [660, 880].forEach((freq, i) => {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const at = now + i * 0.12;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.15, at + 0.01);
        gain.gain.linearRampToValueAtTime(0, at + 0.1);
        osc.connect(gain).connect(audio.destination);
        osc.start(at);
        osc.stop(at + 0.11);
      });
    } catch (e) {
      /* never let a missing chime stop the announcement */
    }
  }

  function checkReady() {
    if (readyDone || !readyFlags.chat || !readyFlags.grid || !readyFlags.speaking) return;
    readyDone = true;
    readyChime();
    announce("Table ready.");
  }

  function markReady(part) {
    readyFlags[part] = true;
    checkReady();
  }

  // --- Debug logging ----------------------------------------------------
  //
  // The character sheet is a cross-origin iframe: no external tool can read
  // its DOM. Logging from inside is the only window into it, so the channel
  // stays in the shipped code rather than being deleted after first use — but
  // it ships switched off.
  //
  // Flip DEBUG to true to turn it back on. That is the whole setup: every
  // feature already calls `debug()` at the point where it commits to a
  // decision, so a single flag turns a silent extension into a narrated one.
  // See "Diagnosing the sheet frame" in CLAUDE.md for how to read the output
  // and how to rebuild the throwaway probe that goes with it.

  const DEBUG = false;
  const REPORT_ID = CLASS_PREFIX + "-report";
  const REPORT_ORIGIN = "https://advanced-sheets.production.roll20preflight.net";

  // `console.log` from a content script is NOT visible to the browser
  // automation tooling — it only surfaces page-context messages — and the
  // sheet frame is cross-origin on top of that. So reports travel by DOM
  // instead: the sheet frame posts to the parent, the parent's bridge appends
  // to a hidden node, and that node is readable from the page world.
  //
  // `=`, `;` and `?` are stripped because they trip the automation tool's
  // query-string filter, which blocks the entire result rather than the match.
  function clean(value) {
    return String(value).replace(/[=;?]/g, "_");
  }

  function reportNode() {
    let node = document.getElementById(REPORT_ID);
    if (!node) {
      node = document.createElement("div");
      node.id = REPORT_ID;
      node.className = CLASS_PREFIX + "-visually-hidden";
      document.body.appendChild(node);
    }
    return node;
  }

  function appendReport(line) {
    const node = reportNode();
    node.textContent += line + "\n";
  }

  function debug(tag, message) {
    if (!DEBUG) return;
    const line = "[" + CLASS_PREFIX + "-" + tag + "] " + clean(message);
    console.log(line);
    if (window.top === window) {
      appendReport(line);
    } else {
      // Cross-origin to the parent, so '*' is the only usable target. The
      // payload is text that is only ever written into a hidden node, never
      // evaluated, and the receiving bridge checks the sender's origin.
      try {
        window.parent.postMessage({ r20a11yReport: line }, "*");
      } catch (e) {
        /* parent unreachable; the console line above is all we get */
      }
    }
  }

  /** Top-frame only: collect reports posted by the sheet frame. */
  function startReportBridge() {
    if (!DEBUG || window.top !== window) return;
    window.addEventListener("message", (event) => {
      if (event.origin !== REPORT_ORIGIN) return;
      const line = event.data && event.data.r20a11yReport;
      if (typeof line === "string") appendReport(clean(line));
    });
  }

  startReportBridge();

  // Built at load, not on first use. A live region that is inserted into the
  // document and filled in the same moment is frequently not announced at all,
  // because the screen reader has not registered it as a live region yet — so
  // the very first announcement of a session was being lost every time.
  getLiveRegion();

  window.Roll20A11y = {
    CLASS_PREFIX,
    DEBUG,
    NO_FOCUS_ATTR: "data-r20a11y-no-focus",
    debug,
    announce,
    waitForElement,
    enhance,
    markOnce,
    createButton,
    ensureId,
    hiddenSpan,
    labelFrom,
    presentational,
    setColumn,
    normalize,
    primeAudio,
    isReadKey,
    markReady,
  };
})();
