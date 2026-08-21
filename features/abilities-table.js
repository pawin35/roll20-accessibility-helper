/**
 * Feature: table semantics and self-describing names for the ABILITIES panel.
 *
 * Roll20's AbilityBlock renders the Mod and Save buttons through PolyButton
 * with no aria-label, so their accessible name is just their content: a
 * screen reader hears "+1, button" twelve times in a row with no way to tell
 * Strength from Charisma, or a modifier from a saving throw. The "Mod" and
 * "Save" captions are sibling spans associated with nothing.
 *
 * The table is deliberately a *transpose* of the visual layout: the six
 * abilities sit side by side on screen, but each becomes a row here, with
 * Ability / Score / Modifier / Saving throw as the columns — that is the axis
 * people actually work along. ARIA permits it because roles describe the
 * accessibility tree, not the box tree, and nothing here moves a node that
 * Roll20 laid out.
 *
 * As in skills-table.js, names are built with `aria-labelledby` over Roll20's
 * own live nodes. The only text this file authors is the six ability names,
 * which are constants and so cannot go stale.
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
    INCREMENTER,
  } = window.Roll20A11y;

  // Roll20 mounts a second, 0x0 sheet iframe running this same file over a full
  // duplicate of the markup. Converting there rewrites a panel nobody can see,
  // and — worse — the failure announcement at the bottom of this file would be
  // spoken on behalf of a frame that was never going to work. A frame whose
  // body has no size is that ghost, and does nothing at all. (Same guard as
  // features/roll-mode-keys.js.)
  if (!document.body || (!document.body.offsetWidth && !document.body.offsetHeight)) {
    debug("abilities", "ghost sheet frame, abilities table not built");
    return;
  }

  const SEL_PANEL = ".inline-abilities-panel__ability-items";
  const SEL_ROW = ".inline-ability";
  // The score control is an incrementer, not the PolyInput the minified source
  // suggested, and this selector is what identifies a row — so when Roll20
  // moved ability scores from PolyIncrementer to UtilityIncrementer, every row
  // failed conversion and the panel announced itself broken. `INCREMENTER` in
  // lib/core.js matches either; see the note there.
  const SEL_SCORE = INCREMENTER.BOX;
  const SEL_SCORE_LABEL = INCREMENTER.LABEL;
  const SEL_SCORE_INPUT = INCREMENTER.INPUT;
  const SEL_BADGES = ".inline-ability__badges";
  const SEL_MOD = ".inline-ability__badges--mod";
  const SEL_SAVE = ".inline-ability__badges--save";
  const SEL_BUTTON = ".poly-button__button";
  const SEL_SELECT = '[data-testid="poly-select"]';

  const COLUMNS = [
    "Ability",
    "Score",
    "Modifier",
    "Saving throw",
    "Saving throw proficiency",
  ];

  const ABILITY_NAMES = {
    STR: "Strength",
    DEX: "Dexterity",
    CON: "Constitution",
    INT: "Intelligence",
    WIS: "Wisdom",
    CHA: "Charisma",
  };

  let validated = 0;
  let skipped = 0;

  // --- Reading which ability a row is -----------------------------------
  //
  // The incrementer's caption carries the key ("STR"), and it is the only
  // place in the row that says which ability this is.

  function abilityNameFor(scoreCell) {
    const label = scoreCell && scoreCell.querySelector(SEL_SCORE_LABEL);
    const key = label && (label.textContent || "").trim().toUpperCase();
    return (key && ABILITY_NAMES[key]) || null;
  }

  // --- Mirroring live values into text ----------------------------------

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

  // --- Column headers ----------------------------------------------------

  function buildHeaderRow(panel) {
    const row = document.createElement("div");
    row.className = "r20a11y-visually-hidden";
    row.setAttribute("role", "row");
    for (const label of COLUMNS) {
      const cell = document.createElement("div");
      cell.setAttribute("role", "columnheader");
      cell.textContent = label;
      row.appendChild(cell);
    }
    panel.insertAdjacentElement("afterbegin", row);
  }

  // --- Rows --------------------------------------------------------------

  function enhanceRow(row) {
    const scoreCell = row.querySelector(SEL_SCORE);
    const badges = row.querySelector(SEL_BADGES);
    const modCell = row.querySelector(SEL_MOD);
    const saveCell = row.querySelector(SEL_SAVE);
    const ability = abilityNameFor(scoreCell);

    // Fail safe: an unrecognised row keeps Roll20's own markup untouched
    // rather than being left half-converted.
    if (!ability || !modCell || !saveCell) {
      skipped++;
      return false;
    }

    row.setAttribute("role", "row");
    // The two badge wrappers become transparent so that the buttons and the
    // dropdown inside them can each be their own column, rather than the
    // saving throw and its proficiency sharing one cell.
    presentational(badges);
    presentational(modCell);
    presentational(saveCell);

    // Roll20's "Mod" and "Save" captions sit loose beside the buttons and are
    // read as stray cell text. The column headers say the same thing in the
    // right place, so silence the captions.
    for (const cell of [modCell, saveCell]) {
      for (const child of cell.children) {
        if (child.tagName === "SPAN") child.setAttribute("aria-hidden", "true");
      }
    }

    const rowHeader = document.createElement("div");
    rowHeader.className = "r20a11y-visually-hidden";
    rowHeader.setAttribute("role", "rowheader");
    rowHeader.textContent = ability;
    row.insertAdjacentElement("afterbegin", rowHeader);

    if (scoreCell) {
      scoreCell.setAttribute("role", "cell");
      // The spinbutton has no accessible name of its own — see SEL_SCORE.
      const input = scoreCell.querySelector(SEL_SCORE_INPUT);
      if (input && !(input.getAttribute("aria-label") || "").trim()) {
        labelFrom(input, [ability + " score"], row);
      }
    }
    // PolyButton's own inner button, which is what actually takes focus.
    // Matching on `.poly-button__button` rather than the `.ability-button` /
    // `.save-button` classes on purpose: those also appear on a presentational
    // div inside the button's slot, so they are ambiguous.
    const modButton = modCell.querySelector(SEL_BUTTON);
    const saveButton = saveCell.querySelector(SEL_BUTTON);
    const select = saveCell.querySelector(SEL_SELECT);

    // Columns 2 and 3 are the buttons' own PolyButton wrappers, so each roll
    // control is a cell in its own right.
    for (const button of [modButton, saveButton]) {
      const wrapper = button && button.closest('[data-testid="poly-button"]');
      if (wrapper) wrapper.setAttribute("role", "cell");
      else if (button) button.setAttribute("role", "cell");
    }

    // Each button supplies its own live "+1" through the self-reference; we
    // only add the words around it. The proficiency state is no longer mixed
    // into the saving-throw button — it has its own column now.
    if (modButton) {
      labelFrom(modButton, ["Roll " + ability, modButton, "check"], row);
    }
    if (saveButton) {
      labelFrom(saveButton, ["Roll " + ability, saveButton, "saving throw"], row);
    }

    // Column 4: proficiency, as its own cell at the end of the row, matching
    // the skills table. It reads its value from `data-selected` on the
    // PolySelect root — the trigger's internal text proved unreliable.
    const trigger = select && select.querySelector("button");
    if (select && trigger) {
      select.setAttribute("role", "cell");
      const readValue = () => {
        const attr = (select.getAttribute("data-selected") || "").trim();
        if (attr) return attr;
        const text = select.querySelector(".poly-select__trigger--text");
        return text ? (text.textContent || "").trim() : "";
      };
      const value = mirrorInto(row, readValue, select, {
        attributes: true,
        attributeFilter: ["data-selected"],
      });
      // Label-only, so it must not also be read as loose text in the row.
      value.setAttribute("aria-hidden", "true");
      labelFrom(trigger, [value], row);
    }

    validated++;
    return true;
  }

  // --- Wiring ------------------------------------------------------------

  enhance(SEL_ROW, (row) => {
    if (!markOnce(row, "abilities-table")) return;

    const panel = row.closest(SEL_PANEL);
    if (!panel) return;

    if (!enhanceRow(row)) return;

    if (markOnce(panel, "abilities-table-container")) {
      panel.setAttribute("role", "table");
      panel.setAttribute("aria-label", "Ability scores");
      buildHeaderRow(panel);
      debug("abilities", "table role applied to " + SEL_PANEL);
    }

    // AbilityBlock renders a fragment of [div.inline-ability, hr], so every
    // row has an <hr> separator sibling. An <hr> child of a table is illegal
    // and would invalidate the whole structure.
    for (const child of panel.children) {
      if (child.tagName === "HR") presentational(child);
    }

    for (let el = row.parentElement; el && el !== panel; el = el.parentElement) {
      presentational(el);
    }
  });

  window.setTimeout(() => {
    if (!validated && !skipped) return;
    debug("abilities", "rows enhanced: " + validated + ", skipped: " + skipped);
    if (validated === 0) {
      announce("Ability scores table could not be made accessible; the panel layout has changed.");
    }
  }, 4000);
})();
