/**
 * Feature: table semantics for the spell lists on the SPELLS tab.
 *
 * One table per spell level — each level has its own list and its own header
 * row, which is why "Add New 1st Level Spell" sits between them rather than
 * inside any table.
 *
  *   .spell-list                       one per level
  *     .list__list
  *       .list__item
  *         .spell-item                 the row (cells are direct children;
  *                                     there used to be a .spell-item__top
  *                                     wrapper, removed by Roll20)
  *           .spell-item__name-chips           name, chat button, ritual /
  *                                             concentration chips
  *           .spell-item__range                "10 feet"
  *           .spell-item__hit-dc               to-hit ("+5 Attack"), or a save
  *                                             like DEX 13
  *           .spell-item__damage               damage ("1d8") or healing,
  *                                             inside .damage-buttons
  *           .spell-item__icon-buttons         edit, expand
  *           .spell-item__expanded (on expand)
  *             .spell-item__description
 *
 * Column names come from Roll20's own header spans (Name / Range / Hit / DC /
 * Damage) rather than being invented, with "Actions" added for the icons,
 * which it does not label.
 *
 * Cells are conditional: a cantrip like Prestidigitation has a name, a range
 * and icons and nothing else. Missing cells get a real empty filler, not just
 * an `aria-colindex` — that lesson came from the attacks table, where index
 * alone did not stop the columns shifting because the screen reader counts
 * cells on a plain `table`.
 *
 * Nothing here checks whether an element is visible. The spells tab's DOM is
 * present from page load but measures 0x0 until the tab is opened, and a
 * visibility gate is what made five earlier attempts to find these rows come
 * back empty.
 */
(function () {
  "use strict";

  const { debug, enhance, markOnce, presentational, setColumn } =
    window.Roll20A11y;

  const SEL_LIST = ".spell-list";
  const SEL_ROW = SEL_LIST + " .spell-item";
  const SEL_TOP = ".spell-item__top";
  const SEL_NAME = ".spell-item__prepare-name-chips, .spell-item__name-chips";
  const SEL_HEADER = "[class*='spells__table-header']";

  const COLUMNS = ["Name", "Range", "Hit / DC", "Damage", "Actions"];

  // Slot selectors in DOM order, each paired with its column. Hit/DC and
  // damage/healing each merged into one container (Roll20 renamed
  // __attack/__dc to __hit-dc, __damage-list/__healing to __damage, and
  // __icons to __icon-buttons); the old names are kept as fallbacks.
  const SLOTS = [
    [".spell-item__range", 2],
    [".spell-item__attack, .spell-item__dc, .spell-item__hit-dc", 3],
    [".spell-item__damage-list, .spell-item__healing, .spell-item__damage", 4],
    [".spell-item__icons, .spell-item__icon-buttons", 5],
  ];

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

  enhance(SEL_ROW, (row) => {
    if (!markOnce(row, "spells-table")) return;

    // Roll20 dropped the .spell-item__top wrapper: cells are now direct
    // children of the row. Fall back to the row itself when it is gone.
    const top = row.querySelector(SEL_TOP);
    const container = top || row;
    const name = row.querySelector(SEL_NAME);

    // Fail safe: an unrecognised row keeps Roll20's markup untouched.
    if (!name) {
      skipped++;
      return;
    }

    row.setAttribute("role", "row");
    presentational(top);

    // Column 1: the spell's name, with its send-to-chat button and any ritual
    // or concentration chips.
    name.setAttribute("role", "rowheader");
    setColumn(name, 1);

    for (let i = 0; i < SLOTS.length; i++) {
      const [selector, column] = SLOTS[i];
      const cell = container.querySelector(":scope > " + selector.split(", ").join(", :scope > "));
      if (cell) {
        cell.setAttribute("role", "cell");
        setColumn(cell, column);
        continue;
      }
      // Fill the gap in place so that counting cells and reading the column
      // index give the same answer.
      let anchor = null;
      for (let j = i + 1; j < SLOTS.length && !anchor; j++) {
        anchor = container.querySelector(
          ":scope > " + SLOTS[j][0].split(", ").join(", :scope > ")
        );
      }
      const cellFiller = filler(column);
      if (anchor) anchor.insertAdjacentElement("beforebegin", cellFiller);
      else container.appendChild(cellFiller);
    }

    // The description only exists while a row is expanded, so it is a trailing
    // cell with no header — giving it one would shift nothing, but naming a
    // column that is usually absent is worse than leaving it unnamed.
    const description = row.querySelector(".spell-item__description");
    if (description) {
      description.setAttribute("role", "cell");
      setColumn(description, COLUMNS.length + 1);
    }

    const list = row.closest(SEL_LIST);
    if (list && markOnce(list, "spells-table-container")) {
      list.setAttribute("role", "table");
      list.setAttribute("aria-label", "Spells");
      list.setAttribute("aria-colcount", String(COLUMNS.length + 1));
      buildHeaderRow(list);
      debug("spells", "table role applied to a " + SEL_LIST);
    }

    // Wrappers between the list and its rows would sit illegally in between.
    for (let el = row.parentElement; el && el !== list; el = el.parentElement) {
      presentational(el);
    }

    validated++;
  });

  // Roll20's own header captions would otherwise be read as loose text inside
  // the table, doubling up with the header row injected above.
  enhance(SEL_HEADER, (caption) => {
    if (!markOnce(caption, "spells-header-caption")) return;
    caption.setAttribute("aria-hidden", "true");
  });

  window.setTimeout(() => {
    if (!validated && !skipped) return;
    debug("spells", "rows enhanced: " + validated + ", skipped: " + skipped);
  }, 5000);
})();
