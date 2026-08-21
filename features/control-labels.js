/**
 * Feature: name the controls Roll20 left unnamed, and silence the captions it
 * left duplicated.
 *
 * Three problems, all outside the ABILITIES and SKILLS tables:
 *
 * 1. Every spinbutton on the sheet is unnamed. `PolyIncrementer` renders
 *
 *      <div data-testid="poly-incrementer" [aria-label="…"]>
 *        <label class="poly-incrementer__label" role="label">Current</label>
 *        <input class="poly-incrementer__input" role="spinbutton">
 *
 * Roll20 also ships a structurally identical `UtilityIncrementer` with
 * `utility-` in place of `poly-` throughout. `INCREMENTER` in lib/core.js
 * matches either.
 *
 *    `role="label"` is not a real ARIA role, so it overrides the <label>
 *    element's own semantics and the input ends up with no accessible name.
 *    This affects HP current / max / temp, the heal-or-damage amount, the hit
 *    dice counts and the ability scores.
 *
 *    The hit dice are the instructive case: Roll20 *did* author a good label,
 *    "Current count of Cleric hit dice" — and put it on the wrapper <div>,
 *    which has no role, so it names nothing. That label is worth rescuing, so
 *    a wrapper aria-label is preferred over the caption when present.
 *
 * 2. The HP panel prints "Damage" and "Heal" as loose captions beside the two
 *    buttons, which already carry those names, so a screen reader hears each
 *    word twice.
 *
 * 3. The initiative button announces "Initiative +1" — a value, with no hint
 *    that activating it rolls anything.
 */
(function () {
  "use strict";

  const { debug, enhance, markOnce, labelFrom, INCREMENTER } = window.Roll20A11y;

  // Either stepper component; see INCREMENTER in lib/core.js.
  const SEL_BOX = INCREMENTER.BOX;
  const SEL_CAPTION = INCREMENTER.LABEL;
  const SEL_INPUT = INCREMENTER.INPUT;

  // Captions that merely repeat the accessible name of the control beside
  // them. Listed explicitly rather than detected: hiding text is only safe
  // when we know it is genuinely redundant.
  const REDUNDANT_CAPTIONS = [
    ".hp-panel__harm-label",
    ".hp-panel__heal-label",
  ].join(", ");

  const SEL_INITIATIVE = 'button[data-testid="initiative-button"]';

  // --- Spinbuttons -------------------------------------------------------

  enhance(SEL_BOX, (box) => {
    if (!markOnce(box, "incrementer-label")) return;

    const input = box.querySelector(SEL_INPUT);
    if (!input) return;

    // Never overwrite a name that already works.
    const named =
      (input.getAttribute("aria-label") || "").trim() ||
      input.getAttribute("aria-labelledby");
    if (named) return;

    const authored = (box.getAttribute("aria-label") || "").trim();
    if (authored) {
      // Move it from the roleless wrapper, where it is inert, onto the control.
      input.setAttribute("aria-label", authored);
      box.removeAttribute("aria-label");
      debug("controls", "moved wrapper label onto spinbutton: " + authored);
      return;
    }

    const caption = box.querySelector(SEL_CAPTION);
    if (!caption || !(caption.textContent || "").trim()) return;

    // Referenced rather than copied, so renaming stays live. A node referenced
    // directly by aria-labelledby still contributes when aria-hidden, so the
    // caption can be hidden to stop it being read a second time as loose text.
    labelFrom(input, [caption], box);
    caption.setAttribute("aria-hidden", "true");
  });

  // --- Duplicated captions ----------------------------------------------

  enhance(REDUNDANT_CAPTIONS, (caption) => {
    if (!markOnce(caption, "redundant-caption")) return;
    caption.setAttribute("aria-hidden", "true");
  });

  // --- Panel gear buttons ------------------------------------------------
  //
  // Every panel has one, and they all announce as "Settings" — a dozen
  // identical buttons with no way to tell which panel each belongs to. Naming
  // them from the panel's own heading is what makes them distinguishable, and
  // it is also the control that opens the editor where entries can be removed.

  // Not scoped to `.sheet-panel__controls`: not every panel wraps its gear in
  // one, and the button's own modifier class is the reliable hook.
  const SEL_GEAR = ".poly-button--gear";
  const GENERIC_LABELS = /^(settings|gears?|panel settings)$/i;
  const PANEL_TITLES = ".help-title__panel-title, .section-header__main-header";

  enhance(SEL_GEAR, (wrapper) => {
    if (!markOnce(wrapper, "panel-gear")) return;

    const button = wrapper.querySelector("button");
    if (!button) return;

    // Roll20 does label these — with "Settings", on every panel. Skipping any
    // button that already had a label meant skipping all of them, which is why
    // the first version of this appeared to do nothing. A generic label is
    // treated as no label; a specific one is still left alone.
    const existing = (button.getAttribute("aria-label") || "").trim();
    if (existing && !GENERIC_LABELS.test(existing)) return;

    const panel = button.closest(".sheet-panel");
    const title = panel && panel.querySelector(PANEL_TITLES);
    const name = title ? (title.textContent || "").trim() : "";

    button.setAttribute("aria-label", name ? "Edit " + name : "Panel settings");
    const icon = wrapper.querySelector('[data-testid="poly-icon"]');
    if (icon) icon.setAttribute("aria-hidden", "true");
    debug("controls", 'gear named "Edit ' + name + '"');
  });

  // --- Initiative --------------------------------------------------------

  enhance(SEL_INITIATIVE, (button) => {
    if (!markOnce(button, "initiative-label")) return;
    if ((button.getAttribute("aria-label") || "").trim()) return;
    // Self-reference supplies the live "Initiative +1"; the connective word is
    // parked on the parent so it is not read back through that reference.
    labelFrom(button, ["Roll", button], button.parentElement || button);
  });
})();
