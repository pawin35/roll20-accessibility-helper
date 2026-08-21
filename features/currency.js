/**
 * Feature: label the money steppers in the INVENTORY tab and speak each change.
 *
 * The inventory tab's purse shows five denominations — Platinum, Gold,
 * Electrum, Silver, Copper — each a PolyIncrementer:
 *
 *   .edit-purse__currency-edit
 *     <span>Gold:</span>                  loose caption, associated with nothing
 *     .poly-incrementer
 *       <label class="poly-incrementer__label">Gold</label>
 *       <input class="poly-incrementer__input" role="spinbutton">
 *       <button class="poly-incrementer__button--increment">  icon only
 *       <button class="poly-incrementer__button--decrement">  icon only
 *
 * Roll20 also ships a structurally identical `UtilityIncrementer` with
 * `utility-` in place of `poly-` throughout. `INCREMENTER` in lib/core.js
 * matches either, so the purse keeps working whichever the sheet renders.
 *
 * The spinbutton input is already named by control-labels.js, but the two
 * +/- buttons have no accessible name at all — they announce as their icon —
 * and clicking one changes the total without any spoken result. So each button
 * is named "Increase/Decrease <denomination>", and the new total is spoken
 * through the shared live region as "<Denomination>: <n>".
 *
 * Labels are re-asserted by a setTimeout sweep rather than a one-shot, because
 * Vue re-renders the panel as the value changes and nothing here may assume
 * which node survives. Announcements are wired by event delegation on document
 * (capture) for the same reason: a listener parked on a specific button dies
 * the moment Vue swaps that button, while a document listener cannot.
 */
(function () {
  "use strict";

  const { announce, debug, enhance, INCREMENTER } = window.Roll20A11y;

  const SEL_DENOM = ".edit-purse__currency-edit";
  // Either stepper component; see INCREMENTER in lib/core.js.
  const SEL_LABEL = INCREMENTER.LABEL;
  const SEL_INPUT = INCREMENTER.INPUT;
  const SEL_INC = INCREMENTER.INCREASE;
  const SEL_DEC = INCREMENTER.DECREASE;

  /** The denomination's name, from the incrementer's own caption. */
  function nameOf(denom) {
    const label = denom.querySelector(SEL_LABEL);
    return label ? (label.textContent || "").trim() : "";
  }

  /**
   * Names one button, unless it already has a name. Idempotent: a pass with
   * nothing to do performs no DOM writes, so the sweep can run freely.
   */
  function label(button, text) {
    if (!button) return;
    if ((button.getAttribute("aria-label") || "").trim()) return;
    button.setAttribute("aria-label", text);
    const icon = button.querySelector('[data-testid="poly-icon"]');
    if (icon) icon.setAttribute("aria-hidden", "true");
  }

  function repair(denom) {
    const name = nameOf(denom);
    if (!name) return;
    label(denom.querySelector(SEL_INC), "Increase " + name);
    label(denom.querySelector(SEL_DEC), "Decrease " + name);
  }

  function sweep() {
    document.querySelectorAll(SEL_DENOM).forEach(repair);
  }

  // Immediate first pass on newly added nodes, plus the poll as the safety net.
  enhance(SEL_DENOM, repair);

  // setTimeout chain rather than setInterval or requestAnimationFrame: rAF is
  // paused entirely while the tab is backgrounded, and a chain cannot stack up.
  (function loop() {
    try {
      sweep();
    } catch (error) {
      debug("currency", "sweep failed: " + (error && error.message));
    }
    window.setTimeout(loop, 500);
  })();

  // --- Announcing the new total ------------------------------------------

  function readValue(denom) {
    const input = denom.querySelector(SEL_INPUT);
    if (!input) return null;
    if (input.value != null && String(input.value).trim() !== "") {
      return String(input.value).trim();
    }
    const now = input.getAttribute("aria-valuenow");
    if (now != null && String(now).trim() !== "") return String(now).trim();
    return "0";
  }

  const lastValue = new WeakMap();

  function announceValue(denom) {
    // Deferred one tick so the read lands after Vue has committed the change.
    window.setTimeout(() => {
      const value = readValue(denom);
      if (value === null) return;
      const name = nameOf(denom);
      if (!name) return;
      if (lastValue.get(denom) === value) return;
      lastValue.set(denom, value);
      announce(name + ": " + value);
    }, 0);
  }

  function elementFrom(event) {
    const target = event.target;
    return target instanceof Element ? target : null;
  }

  // Mouse: clicking either stepper button.
  document.addEventListener(
    "click",
    (event) => {
      const target = elementFrom(event);
      if (!target) return;
      const button = target.closest(SEL_INC + ", " + SEL_DEC);
      if (!button) return;
      const denom = button.closest(SEL_DENOM);
      if (denom) announceValue(denom);
    },
    true
  );

  // Keyboard / typed input on the spinbutton itself.
  document.addEventListener(
    "input",
    (event) => {
      const target = elementFrom(event);
      if (!target || !target.matches(SEL_INPUT)) return;
      const denom = target.closest(SEL_DENOM);
      if (denom) announceValue(denom);
    },
    true
  );
})();
