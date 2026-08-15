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

  function announce(message) {
    const region = getLiveRegion();
    // Clear first so repeating an identical message still gets announced.
    region.textContent = "";
    // setTimeout rather than requestAnimationFrame: rAF is paused entirely
    // while the tab is in the background, which would swallow the message.
    window.setTimeout(() => {
      region.textContent = message;
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
      root.querySelectorAll(enhancer.selector).forEach(enhancer.onMatch);
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

  window.Roll20A11y = {
    CLASS_PREFIX,
    announce,
    waitForElement,
    enhance,
    markOnce,
    createButton,
  };
})();
