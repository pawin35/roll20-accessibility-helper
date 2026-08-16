/**
 * Feature: stop icon names leaking into button labels.
 *
 * Both of Roll20's UI layers name their icons after the glyph file, and both
 * let that name become the button's accessible name:
 *
 *   top frame    <span class="grimoire__roll20-icon">printer</span>
 *                an icon-font span whose *text* is the glyph name, so the
 *                Print button announces as "printer" and the Compendium
 *                button as "openBookCompendium".
 *
 *   sheet frame  <div data-testid="poly-icon" role="img" aria-label="gears">
 *                PolyButton passes `label: iconStart` straight to its icon,
 *                so Damage and Heal announce as "minusHeart" and "plusHeart".
 *                26 of 34 PolyButton call sites pass no aria-label of their
 *                own.
 *
 * Both cases are the same shape, so one file handles both frames.
 *
 * The rule is deliberately conservative, because a button with a bad name is
 * still more usable than a button with no name:
 *
 *   - button already has an aria-label   leave it completely alone. Some of
 *                                        Roll20's own buttons are labelled
 *                                        properly and must not be overwritten.
 *   - button has other real text         hide the icon. The real text is
 *                                        already the label; the glyph name was
 *                                        only ever noise in front of it.
 *   - icon-only, and we know the icon     apply the mapped label, hide the icon.
 *   - icon-only, and we do not            do nothing.
 *
 * Mapped labels match the text printed next to each control on screen. That is
 * a requirement, not a style choice: WCAG 2.5.3 asks that the accessible name
 * contain the visible label, so that a voice-control user saying "click
 * Damage" actually hits the button.
 */
(function () {
  "use strict";

  const { debug, enhance, markOnce } = window.Roll20A11y;

  const SEL_ICON_FONT = ".grimoire__roll20-icon";
  const SEL_POLY_ICON = '[data-testid="poly-icon"]';
  const SEL_ICON = SEL_ICON_FONT + ", " + SEL_POLY_ICON;
  const SEL_BUTTON = 'button, [role="button"]';

  // Only glyphs whose meaning has actually been confirmed on the live page.
  // An unmapped icon-only button is left as it is — inventing a label from the
  // glyph name would dress up a guess as a fact.
  const LABELS = {
    printer: "Print",
    idea: "Tips & Tricks",
    moreVertical: "More options",
    minusHeart: "Damage",
    plusHeart: "Heal",
    // `gears` is handled in control-labels.js instead: a bare "Settings" on
    // every panel is ambiguous when there are a dozen of them, so it is named
    // from the panel it belongs to.
    chat: "Send to chat",
  };

  function isIcon(el) {
    return el.matches && el.matches(SEL_ICON);
  }

  /** The glyph name, wherever this icon flavour happens to keep it. */
  function tokenOf(icon) {
    const text = icon.matches(SEL_ICON_FONT)
      ? icon.textContent
      : icon.getAttribute("aria-label");
    return (text || "").trim();
  }

  /**
   * The button's text with every icon's contribution removed — i.e. whether a
   * real label survives once the glyph noise is gone.
   */
  function textExcludingIcons(button) {
    let out = "";
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.nodeValue;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE || isIcon(node)) return;
      // An <img alt="..."> contributes to the name without appearing in
      // textContent, so it counts as real text.
      if (node.tagName === "IMG") out += " " + (node.getAttribute("alt") || "");
      for (const child of node.childNodes) walk(child);
    };
    for (const child of button.childNodes) walk(child);
    return out.trim();
  }

  function hide(icon) {
    icon.setAttribute("aria-hidden", "true");
  }

  enhance(SEL_ICON, (icon) => {
    if (!markOnce(icon, "icon-label")) return;

    const button = icon.closest(SEL_BUTTON);
    if (!button) return;

    // Never overwrite a label Roll20 got right.
    if ((button.getAttribute("aria-label") || "").trim()) return;

    if (textExcludingIcons(button)) {
      hide(icon);
      return;
    }

    const label = LABELS[tokenOf(icon)];
    if (!label) return;

    button.setAttribute("aria-label", label);
    hide(icon);
    debug("icons", 'labelled icon-only button as "' + label + '"');
  });

  // The dice tray is its own case: no aria-label and no text, just an <img>
  // whose alt is a CSS class name, so it announces as "dice-tray__d20-icon".
  enhance("button.dice-tray__d20-button", (button) => {
    if (!markOnce(button, "icon-label")) return;
    if ((button.getAttribute("aria-label") || "").trim()) return;

    button.setAttribute("aria-label", "Dice tray");
    const img = button.querySelector("img");
    if (img) img.setAttribute("alt", "");
    debug("icons", "labelled the dice tray button");
  });
})();
