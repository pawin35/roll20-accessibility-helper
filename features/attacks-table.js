/**
 * Feature: table semantics for the attack list on the COMBAT tab.
 *
 * A row is a flat run of sibling divs with nothing tying them together:
 *
 *   .attack-item
 *     .attack-item__title-wrapper > .attack-item__title-col
 *        .attack-item__title-chat   name + send-to-chat button
 *        .span--item-row-subtitle   "Melee"
 *     .attack-item__range           "5 ft."
 *     .attack-item__hit-dc          the to-hit button (or a save DC)
 *     .attack-item__damage          the damage buttons
 *     .attack-item__icon-buttons    edit / expand
 *     .attack-item__description     only while expanded
 *     .attack-item__type-range      the same type and range again, as chips
 *     hr
 *
 * so it is heard as "Unarmed Strike / chat / Melee5 ft. / +3 Attack / 2 /
 * editPencil / chevrondown" with no way to tell which number is which.
 *
 * Cells are pinned to their column with `aria-colindex` rather than being left
 * to positional inference. Rows genuinely differ in shape: "True Strike Bonus
 * Damage" has no attack type, so it has no subtitle element at all, and a
 * to-hit block, a damage block and a range are each conditional too. With
 * positional columns, one missing cell silently re-attributes every later cell
 * to the wrong header — a damage roll announced as the range. An explicit
 * column index leaves a gap instead of shifting.
 *
 * The description and the trailing chip row are pinned to columns 7 and 8,
 * which have no header on purpose: the description only exists while a row is
 * expanded, so it has nothing stable to be named by.
 *
 * `.type-range__chips` repeats the Type and Range columns verbatim, so it is
 * hidden — but only the chips. The send-to-chat button beside them stays
 * reachable, because hiding a focusable control is worse than repeating text.
 */
(function () {
  "use strict";

  const { debug, enhance, markOnce, presentational, setColumn } =
    window.Roll20A11y;

  const SEL_ROW = ".attack-item";
  const SEL_LIST = ".attacks__list";
  const SEL_TITLE_WRAPPER = ".attack-item__title-wrapper";
  const SEL_TITLE_COL = ".attack-item__title-col";
  const SEL_TITLE_CHAT = ".attack-item__title-chat";
  const SEL_SUBTITLE = ".span--item-row-subtitle";
  const SEL_CHIPS = ".type-range__chips";

  // Declared columns, in DOM order.
  const COLUMNS = ["Attack", "Type", "Range", "To hit", "Damage", "Actions"];

  // Direct-child cells, paired with the column each one belongs to. Column 1
  // is the row header and column 2 is the subtitle, both of which live inside
  // the title wrapper. Columns 7 and 8 are the headerless trailing cells.
  const CELLS = [
    [".attack-item__range", 3],
    [".attack-item__hit-dc", 4],
    [".attack-item__damage", 5],
    [".attack-item__icon-buttons", 6],
    [".attack-item__description", 7],
    [".attack-item__type-range", 8],
  ];

  const COLUMN_COUNT = 8;

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

  enhance(SEL_ROW, (row) => {
    if (!markOnce(row, "attacks-table")) return;

    const titleChat = row.querySelector(SEL_TITLE_CHAT);

    // Fail safe: an unrecognised row keeps Roll20's markup untouched rather
    // than becoming a half-built table.
    if (!titleChat) {
      skipped++;
      return;
    }

    row.setAttribute("role", "row");
    presentational(row.querySelector(SEL_TITLE_WRAPPER));
    presentational(row.querySelector(SEL_TITLE_COL));

    // Column 1: the attack's name, together with its send-to-chat button.
    titleChat.setAttribute("role", "rowheader");
    setColumn(titleChat, 1);

    // Column 2: absent entirely on attacks with no type, such as True Strike
    // Bonus Damage.
    const subtitle = row.querySelector(SEL_SUBTITLE);
    if (subtitle) {
      subtitle.setAttribute("role", "cell");
      setColumn(subtitle, 2);
    } else {
      // A placeholder, not just a column index. `aria-colindex` alone did not
      // fix the shift: it is well supported on grid and treegrid but not on a
      // plain table, so the screen reader fell back to counting cells and put
      // the range under "Type" regardless. An empty cell in the gap makes
      // counting produce the right answer too, which is what actually gets
      // announced. The index is kept as well, for whatever does honour it.
      const filler = document.createElement("div");
      filler.className = "r20a11y-visually-hidden";
      filler.setAttribute("role", "cell");
      setColumn(filler, 2);
      const titleCol = row.querySelector(SEL_TITLE_COL);
      if (titleCol) titleCol.appendChild(filler);
    }

    // Later columns are direct children and each one is conditional too, so
    // any gap is filled in place, before whichever cell comes next.
    for (let i = 0; i < CELLS.length; i++) {
      const [selector, column] = CELLS[i];
      const cell = row.querySelector(":scope > " + selector);
      if (cell) {
        cell.setAttribute("role", "cell");
        setColumn(cell, column);
        continue;
      }
      // Trailing columns need no filler — nothing after them can be shifted.
      if (column > COLUMNS.length) continue;

      let anchor = null;
      for (let j = i + 1; j < CELLS.length && !anchor; j++) {
        anchor = row.querySelector(":scope > " + CELLS[j][0]);
      }
      const filler = document.createElement("div");
      filler.className = "r20a11y-visually-hidden";
      filler.setAttribute("role", "cell");
      setColumn(filler, column);
      if (anchor) anchor.insertAdjacentElement("beforebegin", filler);
      else row.appendChild(filler);
    }

    // The chips restate the Type and Range columns word for word.
    const chips = row.querySelector(SEL_CHIPS);
    if (chips) chips.setAttribute("aria-hidden", "true");

    // Separators are not valid children of a row.
    for (const child of row.children) {
      if (child.tagName === "HR") presentational(child);
    }

    // The edit and expand icons are named by features/item-row-icons.js,
    // which covers spell rows with the same controls.

    const list = row.closest(SEL_LIST) || row.parentElement;
    if (list && markOnce(list, "attacks-table-container")) {
      list.setAttribute("role", "table");
      list.setAttribute("aria-label", "Attacks");
      list.setAttribute("aria-colcount", String(COLUMN_COUNT));
      buildHeaderRow(list);
      debug(
        "attacks",
        "table role applied to ." + (list.className || "?").split(/\s+/).join(".") +
          " visible: " + (list.offsetWidth > 0 && list.offsetHeight > 0)
      );
    }

    for (let el = row.parentElement; el && el !== list; el = el.parentElement) {
      presentational(el);
    }

    validated++;
  });

  window.setTimeout(() => {
    if (!validated && !skipped) return;
    debug("attacks", "rows enhanced: " + validated + ", skipped: " + skipped);
  }, 4000);
})();
