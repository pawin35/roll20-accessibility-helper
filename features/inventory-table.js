/**
 * Feature: table semantics for the INVENTORY tab's two lists.
 *
 * Equipment and Other Possessions are each a `.draggable-list` of `.item-item`
 * rows, headed by a `.section-header__main-header`:
 *
 *   .item-item
 *     .item-item__title--wrapper
 *       .poly-switch.item-item__equip-switch   equip toggle
 *       .item-item__title-and-chat             name + send-to-chat
 *     .item-item__subtitle                     "Heavy, Gear"
 *     .item-item__weight                       "55 lbs", or "--"
 *     .item-item__quantity-incrementer         qty, with + / - buttons
 *     .item-item__buttons                      edit, expand
 *
 * The row class is `.item-item`, not `.equipment-item` — the latter is in the
 * stylesheet but belongs to the level-up equipment chooser, and probing for it
 * returned nothing.
 *
 * Each list gets its own table, named from its section header, so "Equipment"
 * and "Other Possessions" stay distinguishable.
 *
 * Three controls in every row have no accessible name at all: the equip
 * toggle, the quantity spinbutton (a PolyIncrementer with no caption, so the
 * generic fix in control-labels.js finds nothing to use), and the two stepper
 * buttons, which announce as their icon names.
 */
(function () {
  "use strict";

  const {
    debug,
    enhance,
    markOnce,
    presentational,
    setColumn,
    labelFrom,
    INCREMENTER,
  } = window.Roll20A11y;

  const SEL_ROW = ".item-item";
  const SEL_LIST = ".draggable-list";
  const SEL_TITLE_WRAPPER = ".item-item__title--wrapper";
  const SEL_TITLE = ".item-item__title";
  const SEL_SWITCH = ".item-item__equip-switch";
  const SEL_QTY = ".item-item__quantity-incrementer";
  const SEL_SECTION_HEADER = ".section-header__main-header";

  const SEL_TITLE_AND_CHAT = ".item-item__title-and-chat";

  const COLUMNS = ["Equipped", "Name", "Type", "Weight", "Qty", "Actions"];

  // Slots are matched anywhere in the row, NOT as direct children. The type
  // subtitle lives inside `.item-item__title--wrapper` alongside the name, so
  // a `:scope >` match missed it entirely: the Type column got a filler while
  // the type text stayed inside the name cell and was read as part of it.
  //
  // The wrapper is made presentational, which flattens its children into the
  // row, and their DOM order — switch, name, subtitle — already matches the
  // column order, so positional counting still lines up.
  const SLOTS = [
    [SEL_SWITCH, 1],
    [SEL_TITLE_AND_CHAT, 2],
    [".item-item__subtitle", 3],
    [".item-item__weight", 4],
    [SEL_QTY, 5],
    [".item-item__buttons", 6],
  ];

  // The name is the row header; everything else is an ordinary cell.
  const ROW_HEADER_COLUMN = 2;

  let validated = 0;
  let skipped = 0;

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

  function filler(column) {
    const cell = document.createElement("div");
    cell.className = "r20a11y-visually-hidden";
    cell.setAttribute("role", "cell");
    setColumn(cell, column);
    return cell;
  }

  /** The nearest "Equipment" / "Other Possessions" heading above this list. */
  function sectionName(list) {
    for (let el = list; el; el = el.parentElement) {
      const header = el.querySelector(SEL_SECTION_HEADER);
      if (header) return (header.textContent || "").trim();
    }
    return "Inventory";
  }

  function labelControls(row, title) {
    // Equip toggle: an unnamed button whose only cue is a checked class.
    const toggle = row.querySelector(SEL_SWITCH + " button");
    if (toggle && !(toggle.getAttribute("aria-label") || "").trim()) {
      labelFrom(toggle, ["Equip", title], row);
    }

    const qty = row.querySelector(SEL_QTY);
    if (!qty) return;

    const input = qty.querySelector("input");
    if (input && !(input.getAttribute("aria-label") || "").trim()) {
      labelFrom(input, [title, "quantity"], row);
    }

    // The steppers announce as their icon names. The row already says which
    // item this is, so the names stay short.
    const steppers = [
      [INCREMENTER.INCREASE, "Increase quantity"],
      [INCREMENTER.DECREASE, "Decrease quantity"],
    ];
    for (const [selector, label] of steppers) {
      const button = qty.querySelector(selector);
      if (!button || (button.getAttribute("aria-label") || "").trim()) continue;
      button.setAttribute("aria-label", label);
      const icon = button.querySelector('[data-testid="poly-icon"]');
      if (icon) icon.setAttribute("aria-hidden", "true");
    }
  }

  enhance(SEL_ROW, (row) => {
    if (!markOnce(row, "inventory-table")) return;

    const titleWrapper = row.querySelector(SEL_TITLE_WRAPPER);
    const title = row.querySelector(SEL_TITLE);

    // Fail safe: an unrecognised row keeps Roll20's markup untouched.
    if (!titleWrapper || !title) {
      skipped++;
      return;
    }

    row.setAttribute("role", "row");

    // Flattened so the equip toggle, the name and the type subtitle each
    // become a column of their own rather than sharing one cell.
    presentational(titleWrapper);

    for (let i = 0; i < SLOTS.length; i++) {
      const [selector, column] = SLOTS[i];
      const cell = row.querySelector(selector);
      if (cell) {
        cell.setAttribute(
          "role",
          column === ROW_HEADER_COLUMN ? "rowheader" : "cell"
        );
        setColumn(cell, column);
        continue;
      }
      // Fill gaps so counting cells and reading the column index agree — an
      // item with no type, or a possession with no equip toggle, must not
      // shift everything after it across.
      let anchor = null;
      for (let j = i + 1; j < SLOTS.length && !anchor; j++) {
        anchor = row.querySelector(SLOTS[j][0]);
      }
      const cellFiller = filler(column);
      if (anchor) anchor.insertAdjacentElement("beforebegin", cellFiller);
      else row.appendChild(cellFiller);
    }

    labelControls(row, title);

    const list = row.closest(SEL_LIST);
    if (list && markOnce(list, "inventory-table-container")) {
      list.setAttribute("role", "table");
      list.setAttribute("aria-label", sectionName(list));
      list.setAttribute("aria-colcount", String(COLUMNS.length));
      buildHeaderRow(list);
      debug("inventory", 'table role applied: "' + sectionName(list) + '"');
    }

    for (let el = row.parentElement; el && el !== list; el = el.parentElement) {
      presentational(el);
    }

    validated++;
  });

  window.setTimeout(() => {
    if (!validated && !skipped) return;
    debug("inventory", "rows enhanced: " + validated + ", skipped: " + skipped);
  }, 5000);
})();
