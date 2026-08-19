/**
 * Feature: table semantics for the Weapon Masteries list on the COMBAT tab.
 *
 * A row is a flat run of sibling divs:
 *
 *   .weapon-mastery
 *     .weapon-mastery__item        toggle + name + chat button
 *     .weapon-mastery__property    "Vex"
 *     .weapon-mastery__source      "Barbarian"
 *     .weapon-mastery__actions     edit / expand buttons
 *
 * heard as "Handaxe / Vex / Barbarian / edit Handaxe / expand Handaxe" with no
 * structure tying the property to the weapon. The section's own header names a
 * "Property" and a "Source" column (its "Name" column is visually hidden), so
 * those are reproduced as the table's column headers.
 *
 * Unlike the attacks list, the masteries list carries no class of its own —
 * it is a bare `.poly-list` — so it is located by `closest()` from a row. The
 * row has no nested `.poly-list`, so that lookup is unambiguous.
 */
(function () {
  "use strict";

  const { debug, enhance, markOnce, presentational, setColumn } =
    window.Roll20A11y;

  const SEL_ROW = ".combat__masteries .weapon-mastery";
  const SEL_LIST = ".poly-list";
  const SEL_NAME = ".weapon-mastery__item";
  const SEL_PROPERTY = ".weapon-mastery__property";
  const SEL_SOURCE = ".weapon-mastery__source";
  const SEL_ACTIONS = ".weapon-mastery__actions";

  const COLUMNS = ["Name", "Property", "Source", "Actions"];

  function buildHeaderRow(list) {
    const row = document.createElement("div");
    row.className = "r20a11y-visually-hidden";
    row.setAttribute("role", "row");
    COLUMNS.forEach((label, i) => {
      const cell = document.createElement("div");
      cell.setAttribute("role", "columnheader");
      setColumn(cell, i + 1);
      cell.textContent = label;
      row.appendChild(cell);
    });
    list.insertAdjacentElement("afterbegin", row);
  }

  let validated = 0;
  let skipped = 0;

  enhance(SEL_ROW, (row) => {
    if (!markOnce(row, "masteries-table")) return;

    const name = row.querySelector(SEL_NAME);
    if (!name) {
      skipped++;
      return;
    }

    row.setAttribute("role", "row");

    name.setAttribute("role", "rowheader");
    setColumn(name, 1);

    const property = row.querySelector(SEL_PROPERTY);
    if (property) {
      property.setAttribute("role", "cell");
      setColumn(property, 2);
    }

    const source = row.querySelector(SEL_SOURCE);
    if (source) {
      source.setAttribute("role", "cell");
      setColumn(source, 3);
    }

    const actions = row.querySelector(SEL_ACTIONS);
    if (actions) {
      actions.setAttribute("role", "cell");
      setColumn(actions, 4);
    }

    const list = row.closest(SEL_LIST);
    if (list && markOnce(list, "masteries-table-container")) {
      list.setAttribute("role", "table");
      list.setAttribute("aria-label", "Weapon Masteries");
      list.setAttribute("aria-colcount", String(COLUMNS.length));
      buildHeaderRow(list);
      debug("masteries-table", "table role applied");
    }

    for (let el = row.parentElement; el && el !== list; el = el.parentElement) {
      presentational(el);
    }

    validated++;
  });

  window.setTimeout(() => {
    if (!validated && !skipped) return;
    debug(
      "masteries-table",
      "rows enhanced: " + validated + ", skipped: " + skipped
    );
  }, 4000);
})();
