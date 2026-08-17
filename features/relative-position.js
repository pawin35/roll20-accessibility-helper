/**
 * Feature: a screen-reader-only "Relative position" section for the VTT.
 *
 * Sits directly after the battle-grid table and answers the question the grid
 * itself does not: *how far, and in which direction, is everything else from
 * me?* It measures from the current player's token (the same "first by grid
 * order" rule as alt+M) and lists every other creature token — objects layer
 * only, no furniture — as a distance plus an o'clock bearing taken relative to
 * the reference token's facing: 12 o'clock is straight ahead, 3 is to the
 * right, 6 behind, 9 to the left.
 *
 * Like the grid it is driven entirely by `page/tabletop-bridge.js`'s three
 * postMessage verbs, which this file consumes independently of
 * `features/map-grid.js`. It never writes into the grid's cells, so there is
 * no bind() hook as terrain has; it maintains its own token map from the same
 * messages. The section is always live — rebuilt silently, debounced ~150 ms so
 * a drag renders once per burst — and reached by its heading, never announced
 * on change.
 *
 * Distance uses Roll20's own measurement: grid squares counted per the page's
 * `diagonaltype` ("foure" = diagonals cost one square, the D&D 5e default),
 * multiplied by `scale_number` (5 in a 5e game, so a square is 5 feet) and
 * labelled with `scale_units`. Facing is rounded to the same 8 compass points
 * the grid shows, and the o'clock is computed against that rounded facing so
 * the announced direction and the bearing always agree.
 */
(function () {
  "use strict";

  const { CLASS_PREFIX, debug, gridGeom } = window.Roll20A11y;
  const { DIRECTIONS, cellOf, cellsOf, nameOf, myTokens } = gridGeom;

  const SELF_ORIGIN = "https://app.roll20.net";

  // VTT top frame only. (The manifest registers this in the editor entry, but
  // the sheet-frame entry never includes it, so this is defensive.)
  if (window.top !== window) return;

  // --- Facing ------------------------------------------------------------
  //
  // `rotation` is degrees counter-clockwise: 0 is north, 90 is west, 180 is
  // south. Mirrors `features/map-grid.js`'s facing so the reference line reads
  // the same compass point the grid cell would. The o'clock bearing is taken
  // against this *rounded* facing, not the raw rotation, so it cannot disagree
  // with the direction the reference line announces.

  function normDeg(deg) {
    return (((Number(deg) || 0) % 360) + 360) % 360;
  }

  /** Index into DIRECTIONS for a rotation, rounded to the nearest 45°. */
  function compassIndex(rotation) {
    return Math.round(normDeg(rotation) / 45) % 8;
  }

  function compassWord(rotation) {
    return DIRECTIONS[compassIndex(rotation)];
  }

  /** The rounded facing expressed clockwise from north (0=N, 90=E, …). */
  function facingDegCW(rotation) {
    return (360 - compassIndex(rotation) * 45) % 360;
  }

  /**
   * Grid squares between two cells per the page's diagonal rule. Matches
   * Roll20's own measurement: "foure" (4e) makes a diagonal cost one square,
   * "threefive" alternates 5 then 10 feet (1.5 squares per diagonal),
   * "manhattan" forbids diagonals, "pythagorean" is straight-line.
   */
  function squaresBetween(dc, dr, diagonaltype) {
    const dx = Math.abs(dc);
    const dy = Math.abs(dr);
    switch (diagonaltype) {
      case "manhattan":
        return dx + dy;
      case "threefive":
        return Math.max(dx, dy) + Math.min(dx, dy) / 2;
      case "pythagorean":
        return Math.sqrt(dx * dx + dy * dy);
      case "foure":
      default:
        return Math.max(dx, dy);
    }
  }

  /** Compass bearing to the target, clockwise from north (0=N, 90=E). */
  function bearingDeg(dc, dr) {
    return ((Math.atan2(dc, -dr) * 180) / Math.PI + 360) % 360;
  }

  /** Hour 0..11 for the target's clock position relative to `facing`. */
  function clockHour(bearing, facing) {
    const angle = (bearing - facing + 360) % 360;
    return Math.round(angle / 30) % 12;
  }

  function clockText(hour) {
    return (hour === 0 ? 12 : hour) + " o'clock";
  }

  function unitsWord(scaleUnits) {
    switch (scaleUnits) {
      case "ft":
        return "feet";
      case "m":
        return "meters";
      case "km":
        return "kilometers";
      case "mi":
        return "miles";
      default:
        return scaleUnits || "units";
    }
  }

  // --- State -------------------------------------------------------------

  let grid = null; // { pageId, snapTo, scaleNumber, scaleUnits, diagonaltype, tokens: Map }
  let section = null;
  let content = null;

  // --- Debounced render ---------------------------------------------------
  //
  // The bridge coalesces to one message per token per tick, so a single drag
  // produces a stream of deltas. Rebuilding the whole list on each one would
  // tear the DOM out from under a screen reader mid-list; render once per
  // 150 ms burst instead, the same settle window map-grid.js uses for its
  // change announcements.

  const SETTLE_MS = 150;
  let renderTimer = null;

  function scheduleRender() {
    if (renderTimer === null) {
      renderTimer = window.setTimeout(flushRender, SETTLE_MS);
    }
  }

  function flushRender() {
    renderTimer = null;
    render();
  }

  // --- The section -------------------------------------------------------

  function buildSection() {
    if (section) return;
    section = document.createElement("section");
    section.className = CLASS_PREFIX + "-relative-position";
    section.setAttribute("aria-label", "Relative position");
    const heading = document.createElement("h2");
    heading.className = CLASS_PREFIX + "-visually-hidden";
    heading.textContent = "Relative position";
    section.appendChild(heading);
    content = document.createElement("div");
    section.appendChild(content);

    // Insert directly after the map-grid section so the two read as "Map grid"
    // then "Relative position". map-grid.js loads first and handles the same
    // init message first, so its section exists by the time this runs.
    const mapSection = document.querySelector("." + CLASS_PREFIX + "-map-grid");
    if (mapSection && mapSection.nextSibling) {
      mapSection.parentNode.insertBefore(section, mapSection.nextSibling);
    } else if (mapSection) {
      mapSection.parentNode.appendChild(section);
    } else {
      document.body.appendChild(section);
    }
  }

  function paragraph(text) {
    const el = document.createElement("p");
    el.textContent = text;
    return el;
  }

  function render() {
    if (!content) return;
    content.textContent = "";

    if (!grid) return;
    const mine = myTokens(grid);
    if (!mine.length) {
      content.appendChild(paragraph("You have no token on this map."));
      return;
    }

    const ref = mine[0];
    const refCell = cellOf(ref, grid.snapTo);
    const refWord = compassWord(ref.rotation);
    content.appendChild(
      paragraph("Measured from " + nameOf(ref) + ", facing " + refWord + ".")
    );

    const entries = [];
    for (const token of grid.tokens.values()) {
      if (token.id === ref.id || token.layer !== "objects") continue;
      const cells = cellsOf(token, grid.snapTo);
      const name = nameOf(token);

      // Distance is measured to the token's *nearest* covered cell — how far to
      // reach it — while the o'clock bearing points at the centre of its
      // footprint, so the direction still points at the creature.
      let squares = Infinity;
      let minCol = Infinity;
      let maxCol = -Infinity;
      let minRow = Infinity;
      let maxRow = -Infinity;
      for (const cell of cells) {
        const s = squaresBetween(
          cell.col - refCell.col,
          cell.row - refCell.row,
          grid.diagonaltype
        );
        if (s < squares) squares = s;
        if (cell.col < minCol) minCol = cell.col;
        if (cell.col > maxCol) maxCol = cell.col;
        if (cell.row < minRow) minRow = cell.row;
        if (cell.row > maxRow) maxRow = cell.row;
      }

      if (squares === 0) {
        entries.push({ name, feet: 0, hour: 0, text: name + ": same square." });
        continue;
      }
      const feet = Math.round(squares * grid.scaleNumber);
      const centreCol = (minCol + maxCol) / 2;
      const centreRow = (minRow + maxRow) / 2;
      const hour = clockHour(
        bearingDeg(centreCol - refCell.col, centreRow - refCell.row),
        facingDegCW(ref.rotation)
      );
      entries.push({
        name,
        feet,
        hour,
        text: name + ": " + feet + " " + unitsWord(grid.scaleUnits) + ", " + clockText(hour) + ".",
      });
    }
    entries.sort(
      (a, b) => a.feet - b.feet || a.hour - b.hour || a.name.localeCompare(b.name)
    );

    if (!entries.length) {
      content.appendChild(paragraph("No other tokens."));
      return;
    }
    const list = document.createElement("ol");
    for (const entry of entries) {
      const li = document.createElement("li");
      li.textContent = entry.text;
      list.appendChild(li);
    }
    content.appendChild(list);
  }

  // --- Message handling --------------------------------------------------

  function handleInit(init) {
    if (!init || !init.width || !init.height || !init.snapTo) {
      debug("relpos", "init missing geometry, ignored");
      return;
    }
    if (renderTimer !== null) {
      window.clearTimeout(renderTimer);
      renderTimer = null;
    }
    grid = {
      pageId: init.pageId,
      snapTo: init.snapTo,
      scaleNumber: Number(init.scaleNumber) || 0,
      scaleUnits: init.scaleUnits || "",
      diagonaltype: init.diagonaltype || "foure",
      tokens: new Map(),
    };
    for (const token of init.tokens || []) grid.tokens.set(token.id, token);
    buildSection();
    render();
    debug("relpos", "built, " + grid.tokens.size + " tokens");
  }

  function handleDelta(delta) {
    if (!grid || !delta || !delta.token || delta.pageId !== grid.pageId) return;
    grid.tokens.set(delta.token.id, delta.token);
    scheduleRender();
  }

  function handleRemoved(msg) {
    if (!grid || !msg || msg.pageId !== grid.pageId) return;
    grid.tokens.delete(msg.id);
    scheduleRender();
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== SELF_ORIGIN) return;
    const data = event.data || {};
    if (data.r20a11yGridInit) handleInit(data.r20a11yGridInit);
    else if (data.r20a11yGridDelta) handleDelta(data.r20a11yGridDelta);
    else if (data.r20a11yGridRemoved) handleRemoved(data.r20a11yGridRemoved);
  });
})();
