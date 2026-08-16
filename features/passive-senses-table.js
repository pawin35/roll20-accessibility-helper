/**
 * Feature: table semantics for the passive senses list in the SENSES panel.
 *
 * Roll20 renders it as three unassociated pieces per row:
 *
 *   <div class="senses__list-item">
 *     <span class="passive__name">Investigation</span>
 *     <div class="passive__ability">INT</div>      (a chip)
 *     <div>10</div>                                (value, or an incrementer
 *                                                   while the panel is in
 *                                                   edit mode)
 *
 * so a screen reader hears "Investigation / INT / 10" as three loose strings
 * with nothing tying the number to the sense or saying what the number is.
 *
 * Scoped to `.senses__section--passives`: the "Other Senses" list below reuses
 * `.senses__list-item` with a different shape (`.other-sense__name`, and no
 * ability chip), so matching the row class alone would build a malformed
 * table across both.
 */
(function () {
  "use strict";

  const { debug, enhance, markOnce, presentational } = window.Roll20A11y;

  const SEL_SECTION = ".senses__section--passives";
  const SEL_LIST = ".senses__list";
  const SEL_ROW = SEL_SECTION + " " + SEL_LIST + " > .senses__list-item";
  const SEL_NAME = ".passive__name";
  const SEL_ABILITY = ".passive__ability";

  const COLUMNS = ["Sense", "Ability", "Passive score"];

  let validated = 0;
  let skipped = 0;

  function buildHeaderRow(list) {
    const row = document.createElement("div");
    row.className = "r20a11y-visually-hidden";
    row.setAttribute("role", "row");
    for (const label of COLUMNS) {
      const cell = document.createElement("div");
      cell.setAttribute("role", "columnheader");
      cell.textContent = label;
      row.appendChild(cell);
    }
    list.insertAdjacentElement("afterbegin", row);
  }

  enhance(SEL_ROW, (row) => {
    if (!markOnce(row, "passive-senses")) return;

    const name = row.querySelector(SEL_NAME);
    const ability = row.querySelector(SEL_ABILITY);
    // The value is whichever element follows the ability chip — a plain
    // readout normally, an incrementer while the panel is being edited — so it
    // is taken positionally rather than by a class that changes with mode.
    const value = ability && ability.nextElementSibling;

    // Fail safe: an unrecognised row is left exactly as Roll20 rendered it.
    if (!name || !ability) {
      skipped++;
      return;
    }

    row.setAttribute("role", "row");
    name.setAttribute("role", "rowheader");
    ability.setAttribute("role", "cell");
    if (value) value.setAttribute("role", "cell");

    const list = row.parentElement;
    if (list && markOnce(list, "passive-senses-container")) {
      list.setAttribute("role", "table");
      list.setAttribute("aria-label", "Passive senses");
      buildHeaderRow(list);
      debug(
        "senses",
        "table role applied; visible: " +
          (list.offsetWidth > 0 && list.offsetHeight > 0)
      );
    }

    // Anything between the list and its rows would sit illegally in between.
    for (let el = row.parentElement; el && el !== list; el = el.parentElement) {
      presentational(el);
    }

    validated++;
  });

  window.setTimeout(() => {
    if (!validated && !skipped) return;
    debug("senses", "rows enhanced: " + validated + ", skipped: " + skipped);
  }, 4000);
})();
