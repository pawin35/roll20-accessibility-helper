/**
 * Feature: table semantics for the COMBAT tab's action lists — Actions, Bonus
 * Actions, Reactions and Free Actions.
 *
 * All four sections render the same row shape, so one feature covers them:
 *
 *   .action-item (also .actions__item)
 *     .action-item__drag-name-and-resources   wrapper around columns 1 and 2
 *       .action-item__name-and-resources        name + chat + optional counters
 *       .action-item__buttons                   the dice roll button, optional
 *     .action-item__description               the "Details" text
 *     .action-item__item-actions              edit / expand buttons
 *     hr
 *
 * A row is a flat run of sibling divs, heard as "Actions in Combat / chat /
 * Attack, Dash, Disengage / editPencil / chevrondown" with nothing tying a
 * value to its meaning. Each list also differs only by which section holds it
 * (.combat__actions, .combat__bonus-actions, .combat__reactions,
 * .combat__free-actions), so the table's accessible name is read back from the
 * section's own header rather than hard-coded per list.
 *
 * The dice roll button (".action-item__buttons") sits *inside* the same wrapper
 * as the name. Left there it would be a button buried in the row header — table
 * navigation reads a cell as one unit and never reaches it as a separate stop.
 * So the wrapper is made presentational and the dice is promoted to its own
 * column between the name and Details, matching how Attacks gives Damage its
 * own column. Rows with no dice get a filler cell in that column, the same
 * pattern attacks-table.js uses for its missing "Type".
 */
(function () {
  "use strict";

  const { debug, enhance, labelFrom, markOnce, presentational, setColumn } =
    window.Roll20A11y;

  const SEL_ROW =
    ".combat__actions .action-item, " +
    ".combat__bonus-actions .action-item, " +
    ".combat__reactions .action-item, " +
    ".combat__free-actions .action-item";
  const SEL_LIST = ".actions__list";
  const SEL_WRAPPER = ".action-item__drag-name-and-resources";
  const SEL_NAME = ".action-item__name-and-resources";
  const SEL_ROLL = ".action-item__buttons";
  const SEL_DETAILS = ".action-item__description";
  const SEL_ACTIONS = ".action-item__item-actions";

  const COLUMNS = ["Action", "Roll", "Details", "Actions"];

  function sectionLabel(list) {
    const section = list.closest(".sticky-section");
    const header =
      section && section.querySelector(".section-header__main-header");
    return header ? (header.textContent || "").replace(/\s+/g, " ").trim() : "";
  }

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
    if (!markOnce(row, "actions-table")) return;

    const name = row.querySelector(SEL_NAME);
    if (!name) {
      skipped++;
      return;
    }

    row.setAttribute("role", "row");

    // The wrapper holds both the name (column 1) and the dice (column 2), so
    // it is transparent: the two cells inside it read as row children.
    const wrapper = row.querySelector(SEL_WRAPPER);
    if (wrapper) presentational(wrapper);

    name.setAttribute("role", "rowheader");
    setColumn(name, 1);

    // Column 2: the dice roll button, present only on actions that roll.
    const roll = row.querySelector(SEL_ROLL);
    if (roll) {
      roll.setAttribute("role", "cell");
      setColumn(roll, 2);
      const rollButton = roll.querySelector("button");
      if (rollButton && !(rollButton.getAttribute("aria-label") || "").trim()) {
        // "Roll 1d4" — verb first, value referenced live so a level-up that
        // changes the die relabels the button without any sync code.
        labelFrom(rollButton, ["Roll", rollButton], roll);
      }
    } else {
      const filler = document.createElement("div");
      filler.className = "r20a11y-visually-hidden";
      filler.setAttribute("role", "cell");
      setColumn(filler, 2);
      const anchor = row.querySelector(":scope > " + SEL_DETAILS);
      if (anchor) anchor.insertAdjacentElement("beforebegin", filler);
      else row.appendChild(filler);
    }

    const details = row.querySelector(SEL_DETAILS);
    if (details) {
      details.setAttribute("role", "cell");
      setColumn(details, 3);
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
    if (list && markOnce(list, "actions-table-container")) {
      list.setAttribute("role", "table");
      list.setAttribute("aria-label", sectionLabel(list) || "Actions");
      list.setAttribute("aria-colcount", String(COLUMNS.length));
      buildHeaderRow(list);
      debug(
        "actions-table",
        "table role applied: " + (sectionLabel(list) || "Actions")
      );
    }

    for (let el = row.parentElement; el && el !== list; el = el.parentElement) {
      presentational(el);
    }

    validated++;
  });

  window.setTimeout(() => {
    if (!validated && !skipped) return;
    debug(
      "actions-table",
      "rows enhanced: " + validated + ", skipped: " + skipped
    );
  }, 4000);
})();
