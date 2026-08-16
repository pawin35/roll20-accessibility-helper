/**
 * Feature: table semantics and self-describing names for the SKILLS panel.
 *
 * Roll20 renders SKILLS as a grid of divs. The "Type / Mod / Prof / Bonus"
 * column headers are free-floating spans associated with nothing, and each
 * row's roll button is named "Roll a Acrobatics check" — the bonus, the
 * governing ability and the proficiency state never reach a screen reader.
 *
 * Why ARIA roles and not a real <table>: the panel hangs off a five-level CSS
 * subgrid chain,
 *
 *   .skills__skillList (grid, 4 cols)
 *     > .poly-list > .list__list > .list__item   (subgrid)
 *       > .skill                                 (subgrid, spans all columns)
 *         > .skill__summary                      (subgrid, spans 3 columns)
 *
 * and column alignment survives only through an unbroken chain of grid boxes.
 * A <tr> or <td> anywhere in there destroys the layout. Roles describe the
 * accessibility tree without touching the box tree, so they cost nothing
 * visually.
 *
 * Names come from `aria-labelledby` over Roll20's own live nodes rather than
 * from an `aria-label` we author. `markOnce` means anything we write is
 * written once; a static label would keep reading "+1" after the character
 * gained proficiency, and a confidently-wrong bonus is worse than none.
 */
(function () {
  "use strict";

  const {
    announce,
    debug,
    enhance,
    markOnce,
    labelFrom,
    hiddenSpan,
    presentational,
    setColumn,
  } = window.Roll20A11y;

  const SEL_PANEL = ".skills__panel";
  const SEL_ROW = ".skill";
  const SEL_NAME = ".skill__name";
  const SEL_ABILITY = ".skill__ability";
  const SEL_BONUS = ".skill__bonus";
  const SEL_PROFICIENCY = ".skill__proficiency";
  const SEL_HEADER = ".skills__header";
  // The bonus number on its own. `.skill__bonus` also carries the proficiency
  // mirror, which belongs in its own column, not in the roll button's name.
  const SEL_NUMBER = ".advantaged-number";

  const COLUMNS = ["Skill", "Roll", "Ability", "Bonus", "Proficiency"];

  // Roll20 spells proficiency only into a `data-prof` attribute and a CSS
  // colour, so there is no text for a screen reader to reach.
  const PROFICIENCY_TEXT = {
    Proficient: "proficient",
    Expertise: "expertise",
    Half: "half proficiency",
    Untrained: "not proficient",
  };

  let validated = 0;
  let skipped = 0;

  // --- Finding the table container --------------------------------------
  //
  // Do NOT match the container by class. The sheet renders two skills panels
  // and only the *hidden* one uses `.skills__skillList`; targeting that class
  // produced a flawless table on a 0x0 element while the visible panel — the
  // one an actual user reads — was left untouched.
  //
  // The container is instead identified by structure: it is the ancestor that
  // holds the column-header spans as direct children, because headers and rows
  // must share a grid owner for the columns to line up. That holds in either
  // panel whatever the class happens to be.

  function findContainer(row) {
    let fallback = null;
    for (let el = row.parentElement; el; el = el.parentElement) {
      if (el.querySelector(":scope > " + SEL_HEADER)) return el;
      // A panel with no headers still deserves a table, just without column
      // headers — remember the outermost wrapper inside the panel for that.
      if (el.parentElement && el.parentElement.matches && el.parentElement.matches(SEL_PANEL)) {
        fallback = el;
      }
      if (el.matches(SEL_PANEL)) break;
    }
    return fallback;
  }

  // --- Column headers ---------------------------------------------------

  function buildHeaderRow(list, panel) {
    // Build our own header row rather than re-parenting Roll20's spans. The
    // earlier version moved them, which only worked when they happened to be
    // contiguous direct children of the container — in the visible panel they
    // are not, so it silently produced a table with no headers at all.
    //
    // An injected row is absolutely positioned, so it cannot disturb the grid,
    // it exists identically in both panels, and it can carry a header for the
    // skill-name column, which Roll20 has no span for.
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

    // Roll20's own visible captions would otherwise be announced a second time
    // as stray text inside the table.
    const captions = (panel || list).querySelectorAll(SEL_HEADER);
    for (const caption of captions) caption.setAttribute("aria-hidden", "true");
    debug("skills", "header row built; hid " + captions.length + " Roll20 captions");
  }

  // --- Mirroring live values into text ----------------------------------
  //
  // `aria-labelledby` is the better tool when it works, but it names an
  // element rather than filling it, and a table cell that is empty apart from
  // an accessible name is read as blank by some screen readers. Where a cell
  // has to *contain* the value, mirror it into real text and keep it in sync.

  function mirrorInto(container, read, watched, options) {
    const span = hiddenSpan("");
    const sync = () => {
      span.textContent = read() || "";
    };
    sync();
    new MutationObserver(sync).observe(watched, options);
    container.appendChild(span);
    return span;
  }

  // --- Proficiency, which exists nowhere as text ------------------------

  function mirrorProficiency(bonus) {
    const mirror = hiddenSpan("");
    const sync = () => {
      const raw = bonus.getAttribute("data-prof") || "";
      mirror.textContent = PROFICIENCY_TEXT[raw] || "";
    };
    sync();
    // The only observer in this feature. Everywhere else the value already
    // lives in a text node that `aria-labelledby` reads live; here it does
    // not exist as text at all, so it has to be mirrored and kept in sync.
    new MutationObserver(sync).observe(bonus, {
      attributes: true,
      attributeFilter: ["data-prof"],
    });
    bonus.appendChild(mirror);
  }

  // --- Rows -------------------------------------------------------------

  function enhanceRow(row) {
    const name = row.querySelector(SEL_NAME);
    const ability = row.querySelector(SEL_ABILITY);
    const bonus = row.querySelector(SEL_BONUS);
    const proficiency = row.querySelector(SEL_PROFICIENCY);
    const summary = name && name.parentElement;

    // Fail safe: a row we do not recognise is left exactly as Roll20 rendered
    // it. Half-applied roles would announce as a broken table, which is worse
    // than the untouched panel.
    if (!name || !summary) {
      skipped++;
      return false;
    }

    row.setAttribute("role", "row");
    presentational(summary);

    // Column 0: the skill name on its own, so the row identifies itself before
    // you reach any control.
    //
    // This carries real text rather than `aria-labelledby` pointing at the
    // button: named-but-empty cells are announced as blank. The text is
    // copied from the button and re-copied whenever it changes, so renaming a
    // skill still renames this.
    const rowHeader = document.createElement("div");
    rowHeader.className = "r20a11y-visually-hidden";
    rowHeader.setAttribute("role", "rowheader");
    row.insertAdjacentElement("afterbegin", rowHeader);
    mirrorInto(
      rowHeader,
      () => (name.textContent || "").trim(),
      name,
      { childList: true, characterData: true, subtree: true }
    );

    // Column 1: the roll button. It must stay a button, so its cell is a
    // wrapper; `display: contents` keeps the button itself as the grid item so
    // the wrapper cannot shift the column.
    const rollCell = document.createElement("div");
    rollCell.setAttribute("role", "cell");
    rollCell.style.display = "contents";
    name.insertAdjacentElement("beforebegin", rollCell);
    rollCell.appendChild(name);

    // Columns are pinned rather than inferred from position, so a row missing
    // an optional cell leaves a gap instead of shifting every later cell into
    // the wrong column.
    //
    // The `if (ability)` / `if (bonus)` guards are there because the sheet
    // bundle renders those two conditionally. In practice they have always been
    // present on the live sheet, so the missing-cell case is unverified — do
    // NOT treat it as a known state. If a row ever does turn up without them,
    // note that `aria-colindex` alone will not save it: NVDA counts cells
    // positionally on a plain `role="table"`, which is why attacks-table.js
    // inserts real filler cells. That fix cannot simply be copied here, since
    // these cells would be present when the row is enhanced and removed later —
    // it would need the sweep pattern from combobox-labels.js.
    setColumn(rowHeader, 1);
    setColumn(rollCell, 2);
    if (ability) {
      ability.setAttribute("role", "cell");
      setColumn(ability, 3);
    }
    if (bonus) {
      bonus.setAttribute("role", "cell");
      setColumn(bonus, 4);
      mirrorProficiency(bonus);
    }
    if (proficiency) {
      proficiency.setAttribute("role", "cell");
      setColumn(proficiency, 5);
    }

    // "Roll Acrobatics +1 check". The ability, the proficiency and the column
    // headers all live in their own cells now, so repeating them here only
    // made the button longer to listen to.
    //
    // The bonus is read from `.advantaged-number`, not `.skill__bonus`: the
    // latter also holds the proficiency mirror, which belongs to column 3.
    // Advantage state does sit inside `.advantaged-number`, and that is worth
    // hearing before you roll.
    const number = bonus && (bonus.querySelector(SEL_NUMBER) || bonus);
    labelFrom(name, ["Roll", name, number, "check"], row);

    // Column 4: the proficiency dropdown must announce its current value.
    //
    // Relying on the trigger's own text did not work — it announced no value
    // at all. Rather than depend on the trigger's internal markup, read the
    // value from `data-selected` on the PolySelect root, which is where the
    // component actually keeps it, and fall back to the trigger's text only if
    // that attribute is absent.
    const profTrigger = proficiency && proficiency.querySelector("button");
    if (profTrigger) {
      const readValue = () => {
        const attr = (proficiency.getAttribute("data-selected") || "").trim();
        if (attr) return attr;
        const text = proficiency.querySelector(".poly-select__trigger--text");
        return text ? (text.textContent || "").trim() : "";
      };
      const value = mirrorInto(row, readValue, proficiency, {
        attributes: true,
        attributeFilter: ["data-selected"],
      });
      // Label-only, so it must not also be read as loose text in the row.
      value.setAttribute("aria-hidden", "true");
      // Naming the trigger from the mirror alone keeps it to just the value,
      // with no risk of doubling it up with whatever text is already inside.
      labelFrom(profTrigger, [value], row);
    }

    validated++;
    return true;
  }

  // --- Wiring -----------------------------------------------------------

  enhance(SEL_ROW, (row) => {
    if (!markOnce(row, "skills-table")) return;

    const list = findContainer(row);
    if (!list) {
      skipped++;
      return;
    }

    if (!enhanceRow(row)) return;

    // The container only becomes a table once a row has actually validated:
    // an empty `role="table"` announces as an empty table.
    if (markOnce(list, "skills-table-container")) {
      list.setAttribute("role", "table");
      list.setAttribute("aria-label", "Skills");
      list.setAttribute("aria-colcount", String(COLUMNS.length));
      buildHeaderRow(list, row.closest(SEL_PANEL));
      debug(
        "skills",
        "table role applied to ." + (list.className || "?").split(/\s+/).join(".") +
          " visible: " + (list.offsetWidth > 0 && list.offsetHeight > 0)
      );
    }

    // Wrappers between the table and its rows would sit illegally in between.
    // Walked rather than hardcoded so an extra Roll20 wrapper cannot break it.
    for (let el = row.parentElement; el && el !== list; el = el.parentElement) {
      presentational(el);
    }
  });

  // One report per load, after the panel has settled.
  window.setTimeout(() => {
    if (!validated && !skipped) return;
    debug("skills", "rows enhanced: " + validated + ", skipped: " + skipped);
    if (validated === 0) {
      announce("Skills table could not be made accessible; the panel layout has changed.");
    }
  }, 4000);
})();
