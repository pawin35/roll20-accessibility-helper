/**
 * Feature: table semantics for the Effects list on the COMBAT tab.
 *
 * A row is a flat run of sibling divs:
 *
 *   .effect-item (also .effects__effect)
 *     .effect-item__title         toggle + name + chat button
 *     .effect-item__mod           "+2"
 *     .effect-item__affects       a <ul> of "Damage", "Ability Check", …
 *     .layout-flex--item-actions  edit / expand buttons
 *     hr
 *
 * heard as "Rage / +2 / Damage, Ability Check, Saving Throw / editPencil /
 * chevrondown" with no structure. The section's own header names a "Mod" and
 * an "Affects" column, so those are reproduced as the table's column headers.
 *
 * The Mod and Affects cells are conditional in content but always present —
 * a passive effect like Unarmored Defense renders them as empty 0x0 elements —
 * so their columns never shift and no filler cells are needed. The affects
 * cell is a <ul>; role="cell" flattens it into comma-separated text, matching
 * what a sighted reader sees.
 */
(function () {
  "use strict";

  const { debug, enhance, markOnce, presentational, setColumn } =
    window.Roll20A11y;

  const SEL_ROW = ".combat__effects .effect-item";
  const SEL_LIST = ".effects__list";
  const SEL_NAME = ".effect-item__title";
  const SEL_MOD = ".effect-item__mod";
  const SEL_AFFECTS = ".effect-item__affects";
  const SEL_ACTIONS = ".layout-flex--item-actions";

  const COLUMNS = ["Effect", "Mod", "Affects", "Actions"];

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
    if (!markOnce(row, "effects-table")) return;

    const name = row.querySelector(SEL_NAME);
    if (!name) {
      skipped++;
      return;
    }

    row.setAttribute("role", "row");

    name.setAttribute("role", "rowheader");
    setColumn(name, 1);

    const mod = row.querySelector(SEL_MOD);
    if (mod) {
      mod.setAttribute("role", "cell");
      setColumn(mod, 2);
    }

    const affects = row.querySelector(SEL_AFFECTS);
    if (affects) {
      affects.setAttribute("role", "cell");
      setColumn(affects, 3);
    }

    const actions = row.querySelector(SEL_ACTIONS);
    if (actions) {
      actions.setAttribute("role", "cell");
      setColumn(actions, 4);
    }

    for (const child of row.children) {
      if (child.tagName === "HR") presentational(child);
    }

    const list = row.closest(SEL_LIST);
    if (list && markOnce(list, "effects-table-container")) {
      list.setAttribute("role", "table");
      list.setAttribute("aria-label", "Effects");
      list.setAttribute("aria-colcount", String(COLUMNS.length));
      buildHeaderRow(list);
      debug("effects-table", "table role applied");
    }

    for (let el = row.parentElement; el && el !== list; el = el.parentElement) {
      presentational(el);
    }

    validated++;
  });

  window.setTimeout(() => {
    if (!validated && !skipped) return;
    debug(
      "effects-table",
      "rows enhanced: " + validated + ", skipped: " + skipped
    );
  }, 4000);
})();
