/**
 * Feature: name the icon-only buttons that repeat on every item row.
 *
 * Attack, spell and inventory rows all end with an edit pencil and an expand
 * chevron. Neither carries a label, so they announce as "editPencil" and
 * "chevrondown".
 *
 * Keyed on the buttons' own modifier classes — `poly-button--item-row-expand`
 * and `poly-button--edit-pencil` — rather than on the row containers around
 * them. Those classes say what the button *is*, so one rule covers every list
 * on the sheet, including ones not looked at yet. Matching on containers meant
 * re-deriving a new row class for each tab and missing whichever list had not
 * been inspected.
 *
 * Still deliberately not in the global map in icon-button-labels.js: a bare
 * chevron opens the AC and Speed dropdowns too, where "Show description" would
 * be wrong. The modifier class is what makes the wording safe to assert.
 */
(function () {
  "use strict";

  const { enhance, markOnce } = window.Roll20A11y;

  const SEL_EXPAND = ".poly-button--item-row-expand";
  const SEL_EDIT = ".poly-button--edit-pencil";
  const SEL_ICON = '[data-testid="poly-icon"]';

  // The chevron flips as the row opens, so the wording follows the icon rather
  // than assuming a direction.
  const EXPAND_LABELS = {
    chevrondown: "Show description",
    chevronup: "Hide description",
    chevronDown: "Show description",
    chevronUp: "Hide description",
  };

  /** What the row is, so "Edit" can say what it edits. */
  function editLabel(button) {
    if (button.closest(".attack-item")) return "Edit attack";
    if (button.closest(".spell-item")) return "Edit spell";
    if (button.closest(".effect-item")) return "Edit effect";
    return "Edit item";
  }

  function apply(wrapper, resolve) {
    const button = wrapper.matches("button")
      ? wrapper
      : wrapper.querySelector("button");
    if (!button) return;
    // Never overwrite a name that already works.
    if ((button.getAttribute("aria-label") || "").trim()) return;

    const icon = wrapper.querySelector(SEL_ICON);
    const token = icon ? (icon.getAttribute("aria-label") || "").trim() : "";
    const label = resolve(button, token);
    if (!label) return;

    button.setAttribute("aria-label", label);
    if (icon) icon.setAttribute("aria-hidden", "true");
  }

  enhance(SEL_EXPAND, (wrapper) => {
    if (!markOnce(wrapper, "item-row-expand")) return;
    apply(wrapper, (button, token) => EXPAND_LABELS[token] || "Show description");
  });

  enhance(SEL_EDIT, (wrapper) => {
    if (!markOnce(wrapper, "item-row-edit")) return;
    apply(wrapper, (button) => editLabel(button));
  });
})();
