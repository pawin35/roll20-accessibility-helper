/**
 * Feature: label the remaining unlabeled controls in the COMBAT tab sections.
 *
 * Three controls in the Weapon Masteries and Effects lists ship with no
 * accessible name, so a screen reader hears only their role:
 *
 *   - `.weapon-mastery__chat-button` — the one chat button whose icon carries
 *     no glyph label (its action/effect siblings get "Send to chat" from
 *     Roll20; this one does not).
 *   - `.utility-switch__button` in a mastery row — a `role="switch"` toggling
 *     whether the weapon mastery is active.
 *   - `.poly-switch__button` in an effect row — a `role="switch"` toggling the
 *     effect on and off.
 *
 * The switches are named from the thing they toggle via `aria-labelledby`,
 * referencing Roll20's own name span rather than copying the text. That keeps
 * the name live: a renamed weapon or effect relabels the switch automatically,
 * and the feature never authors a value that can go stale.
 */
(function () {
  "use strict";

  const { debug, enhance, markOnce, labelFrom } = window.Roll20A11y;

  // The mastery "send to chat" button. The label is a fixed phrase, so a plain
  // aria-label is correct; the icon is hidden so it cannot leak a glyph name.
  enhance(".combat__masteries .weapon-mastery__chat-button", (button) => {
    if (!markOnce(button, "mastery-chat")) return;
    if ((button.getAttribute("aria-label") || "").trim()) return;
    button.setAttribute("aria-label", "Send to chat");
    const icon = button.querySelector(".utility-icon");
    if (icon) icon.setAttribute("aria-hidden", "true");
    debug("combat-controls", "labelled mastery chat button");
  });

  // Mastery toggle: named by the weapon it masters.
  enhance(".combat__masteries .utility-switch__button", (button) => {
    if (!markOnce(button, "mastery-switch")) return;
    if ((button.getAttribute("aria-label") || "").trim()) return;
    if (button.getAttribute("aria-labelledby")) return;
    const row = button.closest(".weapon-mastery");
    const name = row && row.querySelector(".weapon-mastery__name");
    if (!name) return;
    labelFrom(button, [name]);
    debug("combat-controls", "labelled mastery switch");
  });

  // Effect toggle: named by the effect it toggles.
  enhance(".combat__effects .poly-switch__button", (button) => {
    if (!markOnce(button, "effect-switch")) return;
    if ((button.getAttribute("aria-label") || "").trim()) return;
    if (button.getAttribute("aria-labelledby")) return;
    const row = button.closest(".effect-item");
    const name = row && row.querySelector(".effect-item__title .span--item-row-title");
    if (!name) return;
    labelFrom(button, [name]);
    debug("combat-controls", "labelled effect switch");
  });
})();
