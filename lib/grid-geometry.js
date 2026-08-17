/**
 * Roll20 Accessibility Helper — shared grid geometry.
 *
 * Extracted from `features/map-grid.js` and `features/relative-position.js`
 * to eliminate verbatim duplication of the functions that turn a token's pixel
 * position into grid coordinates. Both files consume the same bridge data
 * model, so these are character-for-character identical across them.
 *
 * Published on `window.Roll20A11y.gridGeom` alongside the other helpers in
 * `lib/core.js`. Must be listed **after** `lib/core.js` and **before** the
 * feature files in `manifest.json`.
 */
(function () {
  "use strict";

  const DIRECTIONS = [
    "north", "north-west", "west", "south-west",
    "south", "south-east", "east", "north-east",
  ];

  /** Column 0 → "A", 25 → "Z", 26 → "AA", … */
  function colLabel(col) {
    let s = "";
    let n = col + 1;
    while (n > 0) {
      n -= 1;
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26);
    }
    return s;
  }

  function cellOf(token, snapTo) {
    const col = Math.floor((Number(token.left) - Number(token.width) / 2) / snapTo);
    const row = Math.floor((Number(token.top) - Number(token.height) / 2) / snapTo);
    return { col, row };
  }

  /**
   * The cells a token's footprint covers. `width`/`height` are pixel footprints,
   * so a Large (2×2) token spans `round(width/snapTo)` columns and rows; `cellOf`
   * still returns the top-left cell (used for alt+M and grid-order sorting).
   */
  function cellsOf(token, snapTo) {
    const left = Number(token.left) || 0;
    const top = Number(token.top) || 0;
    const w = Number(token.width) || 0;
    const h = Number(token.height) || 0;
    const col0 = Math.floor((left - w / 2) / snapTo);
    const row0 = Math.floor((top - h / 2) / snapTo);
    const colSpan = Math.max(1, Math.round(w / snapTo));
    const rowSpan = Math.max(1, Math.round(h / snapTo));
    const cells = [];
    for (let r = row0; r < row0 + rowSpan; r++) {
      for (let c = col0; c < col0 + colSpan; c++) {
        cells.push({ col: c, row: r });
      }
    }
    return cells;
  }

  function cellRef(col, row) {
    return colLabel(col) + (row + 1);
  }

  function nameOf(token) {
    return token.name || "Unknown creature";
  }

  /**
   * Returns the player's own tokens from `grid.tokens`, sorted by grid
   * position (top-left first). `grid` is `{ tokens: Map, snapTo }`.
   */
  function myTokens(grid) {
    const found = [];
    for (const token of grid.tokens.values()) {
      if (token.mine) found.push(token);
    }
    found.sort((a, b) => {
      const ca = cellOf(a, grid.snapTo);
      const cb = cellOf(b, grid.snapTo);
      return ca.row - cb.row || ca.col - cb.col;
    });
    return found;
  }

  window.Roll20A11y = window.Roll20A11y || {};
  window.Roll20A11y.gridGeom = {
    DIRECTIONS,
    colLabel,
    cellOf,
    cellsOf,
    cellRef,
    nameOf,
    myTokens,
  };
})();
