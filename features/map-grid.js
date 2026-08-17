/**
 * Feature: a screen-reader-only battle-grid table for the VTT.
 *
 * The tabletop renders to an opaque WebGL canvas with no DOM, so there is
 * nothing to walk or name there. `page/tabletop-bridge.js` (page world, where
 * `Campaign` lives) reads the model and forwards it here over
 * `window.postMessage`; this file turns that into a real `<table>` at the end
 * of `<body>` — one row per grid row, one cell per column, each token placed in
 * the cell it occupies.
 *
 * The table is visually hidden but present in the accessibility tree, so a
 * screen reader reaches it by table navigation or by the "Map grid" heading.
 * Its cells are also focusable: alt+M jumps to the current player's token, and
 * the arrow keys then walk the grid cell by cell (a roving tabindex keeps one
 * cell in the Tab order at a time). Focusing a cell reads it, since its text
 * already holds the coordinate, token, and terrain.
 *
 * Reactivity: every forwarded delta rewrites only the affected cell(s); the
 * sound and the announcement are debounced ~150 ms so a drag is spoken once,
 * not once per square crossed. Selection events are never forwarded, so a click
 * that merely selects a token is silent.
 */
(function () {
  "use strict";

  const { CLASS_PREFIX, announce, debug } = window.Roll20A11y;

  const SELF_ORIGIN = "https://app.roll20.net";
  const SHEET_ORIGIN = "https://advanced-sheets.production.roll20preflight.net";

  // --- "Jump to my token" (alt+M) ----------------------------------------
  //
  // Focuses the grid cell holding the current player's token — the token the
  // bridge flagged `mine` because its `controlledby` names the current player.
  // Focus lands on the cell, so the screen reader reads it, and the user can
  // then walk the grid from there. Matched on `event.code`, not `event.key`, so
  // a non-US layout still works.

  function myTokenKey(event) {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
    return event.code === "KeyM";
  }

  // Sheet frame: while focus is in the floating character sheet the keydown
  // never reaches the VTT document, so forward it. The top frame focuses the
  // cell, and focus therefore ends up in this frame however the key arrived.
  if (window.top !== window) {
    document.addEventListener(
      "keydown",
      (event) => {
        if (!myTokenKey(event)) return;
        event.preventDefault();
        try {
          window.parent.postMessage({ r20a11yMyToken: true }, SELF_ORIGIN);
        } catch (e) {
          /* parent unreachable; nothing else this frame can do */
        }
      },
      true
    );

    // Only failures come back: on success focus has moved up to the cell, so
    // the top frame is where the user now is.
    window.addEventListener("message", (event) => {
      if (event.origin !== SELF_ORIGIN) return;
      const said = event.data && event.data.r20a11yMyTokenResult;
      if (typeof said === "string") announce(said);
    });

    return;
  }

  // --- Facing ------------------------------------------------------------
  //
  // `rotation` is degrees counter-clockwise: 0 is north, 90 is west, 180 is
  // south. Rounded to the nearest of 8 compass points so 45° reads
  // "north-west" rather than a raw number.

  const DIRECTIONS = [
    "north", "north-west", "west", "south-west",
    "south", "south-east", "east", "north-east",
  ];

  function facing(rotation) {
    const deg = (((Number(rotation) || 0) % 360) + 360) % 360;
    return DIRECTIONS[Math.round(deg / 45) % 8];
  }

  // --- Grid geometry -----------------------------------------------------

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

  // --- Cell text ---------------------------------------------------------

  function nameOf(token) {
    return token.name || "Unknown creature";
  }

  function hpText(token) {
    if (!token.playerControlled || token.hp == null) return "";
    let text = token.hp + " hit points";
    if (token.tempHP) text += ", " + token.tempHP + " temporary hit points";
    return text;
  }

  /** The terrain label for a cell, "" when terrain is absent or blank. */
  function cellLabel(col, row) {
    const terrain = window.Roll20A11y.terrain;
    if (!terrain) return "";
    const label = terrain.labelAt(col, row);
    return label && label !== "blank" ? label : "";
  }

  function tokenText(token, col, row) {
    let text = nameOf(token);
    const hp = hpText(token);
    if (hp) text += " \u2014 " + hp;
    text += ", facing " + facing(token.rotation);
    const conds = (token.conditions || [])
      .filter(Boolean)
      .map((c) => c.toLowerCase())
      .join(", ");
    if (conds) text += ", " + conds;
    const terrain = cellLabel(col, row);
    if (terrain) text += ", on " + terrain;
    return text;
  }

  /**
   * Directional announcements for the attribute-only changes in a same-cell
   * delta. Returns [] when nothing worth announcing changed — including the
   * initial store load (HP or conditions becoming available) and store writes
   * that leave HP, facing, conditions and name untouched.
   */
  function attributeChanges(prev, token) {
    const changes = [];

    // HP only exists for player-controlled tokens and only once the store has
    // loaded; requiring both sides non-null makes the null → value load silent
    // while still catching a real damage/heal.
    if (prev.hp != null && token.hp != null) {
      const prevTemp = prev.tempHP || 0;
      const tokenTemp = token.tempHP || 0;
      if (prev.hp !== token.hp || prevTemp !== tokenTemp) {
        const parts = [];
        if (token.hp !== prev.hp) {
          parts.push(
            token.hp < prev.hp
              ? "took damage: " + token.hp + " hit points"
              : "healed: " + token.hp + " hit points"
          );
        }
        if (tokenTemp !== prevTemp) {
          parts.push(
            tokenTemp > prevTemp
              ? "gained " + (tokenTemp - prevTemp) + " temporary hit points"
              : "lost " + (prevTemp - tokenTemp) + " temporary hit points"
          );
        }
        if (parts.length) changes.push(nameOf(token) + " " + parts.join("; ") + ".");
      }
    }

    // `facing` rounds to the 8 compass points the grid displays, so a sub-45°
    // nudge is silent. Announced for every token, player-controlled or not.
    if (facing(prev.rotation) !== facing(token.rotation)) {
      changes.push(nameOf(token) + " turned to face " + facing(token.rotation) + ".");
    }

    // Conditions: only once both sides are loaded (null = store not yet loaded),
    // so the initial load does not announce a burst of "is X" for conditions
    // the character already had.
    if (prev.conditions != null && token.conditions != null) {
      const added = token.conditions.filter((c) => prev.conditions.indexOf(c) < 0);
      const removed = prev.conditions.filter((c) => token.conditions.indexOf(c) < 0);
      for (const c of added) {
        changes.push(nameOf(token) + " is " + c.toLowerCase() + ".");
      }
      for (const c of removed) {
        changes.push(nameOf(token) + " is no longer " + c.toLowerCase() + ".");
      }
    }

    if (prev.name && token.name && prev.name !== token.name) {
      changes.push(prev.name + " renamed to " + token.name + ".");
    }

    return changes;
  }

  // --- The table ---------------------------------------------------------

  // The one section, appended to <body> once; its table is rebuilt on page
  // switch but the section itself persists so its heading stays put.
  let section = null;
  let table = null;
  let grid = null; // { pageId, width, height, snapTo, tokens: Map, byCell: Map }
  let tds = null; // Map<"col:row", td>
  let background = null; // the background image's { imgsrc, left, top, width, height }

  function buildSection(init) {
    if (!section) {
      section = document.createElement("section");
      section.className = CLASS_PREFIX + "-map-grid";
      section.setAttribute("aria-label", "Map grid");
      const heading = document.createElement("h2");
      heading.className = CLASS_PREFIX + "-visually-hidden";
      heading.textContent = "Map grid";
      section.appendChild(heading);
      document.body.appendChild(section);

      // The terrain button belongs in this section, above the table. Bound once
      // (the section outlives every rebuilt table), with getters so it always
      // reads the current page's background and grid.
      if (window.Roll20A11y.terrain) {
        window.Roll20A11y.terrain.bind({
          section,
          reRender: renderAll,
          getBackground: () => background,
          getGrid: () => grid,
        });
      }

      // Arrow keys walk the grid while a cell is focused; the handler lives on
      // the section (which persists across page switches) and checks the event
      // target so it only acts on our cells, not the terrain button.
      section.addEventListener("keydown", arrowNav);
    }
    if (table) table.remove();

    table = document.createElement("table");
    table.setAttribute("aria-rowcount", String(init.height));
    table.setAttribute("aria-colcount", String(init.width));

    // No row or column headers: every cell carries its own coordinate, so a
    // screen reader hears "blank, A1" or the token text ending in ", F4"
    // without any header to line up against. Empty cells are filled at build
    // time and overwritten when a token lands in them.
    const tbody = document.createElement("tbody");
    tds = new Map();
    for (let r = 0; r < init.height; r++) {
      const tr = document.createElement("tr");
      for (let c = 0; c < init.width; c++) {
        const td = document.createElement("td");
        td.textContent = "blank, " + cellRef(c, r);
        td.setAttribute("tabindex", "-1");
        td.dataset.col = c;
        td.dataset.row = r;
        tds.set(c + ":" + r, td);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    section.appendChild(table);
  }

  function keyOf(col, row) {
    return col + ":" + row;
  }

  function writeCell(col, row) {
    const td = tds.get(keyOf(col, row));
    if (!td) return;
    const ref = cellRef(col, row);
    const ids = grid.byCell.get(keyOf(col, row)) || [];
    const parts = ids
      .map((id) => {
        const token = grid.tokens.get(id);
        return token ? tokenText(token, col, row) + ", " + ref : "";
      })
      .filter(Boolean);
    const terrain = cellLabel(col, row);
    if (parts.length) {
      td.textContent = parts.join("; ");
    } else if (terrain) {
      td.textContent = terrain + ", " + ref;
    } else {
      td.textContent = "blank, " + ref;
    }
  }

  /** Re-render every cell — used after terrain is identified. */
  function renderAll() {
    if (!tds) return;
    for (const key of tds.keys()) {
      const sep = key.indexOf(":");
      writeCell(Number(key.slice(0, sep)), Number(key.slice(sep + 1)));
    }
  }

  function place(token) {
    grid.tokens.set(token.id, token);
    for (const cell of cellsOf(token, grid.snapTo)) {
      const key = keyOf(cell.col, cell.row);
      if (!grid.byCell.has(key)) grid.byCell.set(key, []);
      const ids = grid.byCell.get(key);
      if (ids.indexOf(token.id) < 0) ids.push(token.id);
      writeCell(cell.col, cell.row);
    }
  }

  // --- The change tone ---------------------------------------------------
  //
  // Synthesised, not shipped: a short high blip distinct from the chat's
  // boundary tones (440/660 Hz). A remote change has no user gesture behind it,
  // and Chrome's autoplay policy will not let an AudioContext start without
  // one — so the context is created *only* inside a real pointer/keydown, and
  // `tone()` skips silently until that has happened. The announcement still
  // carries the change either way.

  let audio = null;

  function primeAudio() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audio) audio = new Ctx();
      if (audio.state === "suspended") audio.resume();
    } catch (e) {
      /* no audio available; the announcement still says what changed */
    }
  }

  function tone() {
    // Not primed by a gesture yet: do not construct an AudioContext here, or
    // Chrome logs an autoplay warning for every remote change before the first
    // interaction.
    if (!audio || audio.state !== "running") return;
    try {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      const at = audio.currentTime;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.1, at + 0.01);
      gain.gain.linearRampToValueAtTime(0, at + 0.1);
      osc.connect(gain).connect(audio.destination);
      osc.start(at);
      osc.stop(at + 0.11);
    } catch (e) {
      /* never let a missing tone stop the announcement */
    }
  }

  document.addEventListener("pointerdown", primeAudio, { once: true, capture: true });
  document.addEventListener("keydown", primeAudio, { once: true, capture: true });

  // --- Announcements, debounced -----------------------------------------
  //
  // One token per key, so a drag that moves and rotates a token collapses to a
  // single phrase. Same settle window as the chat's burst guard.

  const SETTLE_MS = 150;
  const pending = new Map();
  let announceTimer = null;

  function queue(key, phrase) {
    pending.set(key, phrase);
    if (announceTimer === null) {
      announceTimer = window.setTimeout(flushAnnounce, SETTLE_MS);
    }
  }

  function flushAnnounce() {
    announceTimer = null;
    const phrases = Array.from(pending.values());
    pending.clear();
    if (!phrases.length) return;
    tone();
    announce(phrases.join(" "));
  }

  // --- Message handling --------------------------------------------------

  function handleInit(init) {
    if (!init || !init.width || !init.height || !init.snapTo) {
      debug("mapgrid", "init missing geometry, ignored");
      return;
    }
    built = true;
    const pageChanged = !grid || grid.pageId !== init.pageId;
    grid = {
      pageId: init.pageId,
      width: init.width,
      height: init.height,
      snapTo: init.snapTo,
      tokens: new Map(),
      byCell: new Map(),
    };
    background = init.background || null;
    // Terrain labels belong to a page and are never cached, so a page switch
    // clears them. A re-init of the same page (the ready handshake or a reset)
    // keeps them.
    if (pageChanged && window.Roll20A11y.terrain) window.Roll20A11y.terrain.reset();
    buildSection(init);
    for (const token of init.tokens) place(token);
    debug(
      "mapgrid",
      "built " + init.width + "x" + init.height + " grid, " + init.tokens.length + " tokens"
    );
  }

  function handleDelta(delta) {
    if (!grid || !delta || !delta.token || delta.pageId !== grid.pageId) return;
    const token = delta.token;
    const prev = grid.tokens.get(token.id);
    const prevCells = prev ? cellsOf(prev, grid.snapTo) : null;
    const newCells = cellsOf(token, grid.snapTo);
    const newCell = newCells[0];

    if (prevCells) {
      for (const cell of prevCells) {
        const ids = grid.byCell.get(keyOf(cell.col, cell.row));
        if (ids) {
          const i = ids.indexOf(token.id);
          if (i >= 0) ids.splice(i, 1);
          writeCell(cell.col, cell.row);
        }
      }
    }
    place(token);

    const name = nameOf(token);
    const ref = cellRef(newCell.col, newCell.row);
    const prevCell = prevCells ? prevCells[0] : null;
    if (!prev) {
      queue(token.id, name + " placed at " + ref + ".");
    } else if (!prevCell || prevCell.col !== newCell.col || prevCell.row !== newCell.row) {
      queue(token.id, name + " moved to " + ref + ".");
    } else {
      // Same cell: only attribute changes are possible. place() has already
      // rewritten the cell, so the grid is correct regardless; announce only
      // real changes and stay silent for the initial store load and for store
      // writes that change nothing we show.
      const changes = attributeChanges(prev, token);
      if (changes.length) queue(token.id, changes.join(" "));
    }
  }

  function handleRemoved(msg) {
    if (!grid || !msg || msg.pageId !== grid.pageId) return;
    const prev = grid.tokens.get(msg.id);
    if (!prev) return;
    for (const cell of cellsOf(prev, grid.snapTo)) {
      const ids = grid.byCell.get(keyOf(cell.col, cell.row));
      if (ids) {
        const i = ids.indexOf(msg.id);
        if (i >= 0) ids.splice(i, 1);
        writeCell(cell.col, cell.row);
      }
    }
    grid.tokens.delete(msg.id);
    queue("!" + msg.id, nameOf(prev) + " removed.");
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== SELF_ORIGIN) return;
    const data = event.data || {};
    if (data.r20a11yGridInit) handleInit(data.r20a11yGridInit);
    else if (data.r20a11yGridDelta) handleDelta(data.r20a11yGridDelta);
    else if (data.r20a11yGridRemoved) handleRemoved(data.r20a11yGridRemoved);
  });

  // --- Jump to my token --------------------------------------------------

  function myTokens() {
    if (!grid) return [];
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

  /**
   * Move focus to a cell, keeping a roving tabindex: exactly one cell holds
   * `tabindex="0"` at a time so Tab can re-enter the grid where the user left
   * it. Focusing a cell makes the screen reader read it, since the cell text
   * already carries the coordinate / token / terrain.
   */
  function focusCell(td) {
    const prev = table && table.querySelector('td[tabindex="0"]');
    if (prev && prev !== td) prev.setAttribute("tabindex", "-1");
    td.setAttribute("tabindex", "0");
    td.focus();
  }

  /**
   * Arrow keys move focus to the neighbouring cell, clamped to the grid by
   * whether a `<td>` exists for the target. No announcement of our own: the
   * focus change itself is what the screen reader reads.
   */
  function arrowNav(event) {
    const td = event.target;
    if (!td || td.tagName !== "TD") return;
    let dc = 0;
    let dr = 0;
    if (event.key === "ArrowUp") dr = -1;
    else if (event.key === "ArrowDown") dr = 1;
    else if (event.key === "ArrowLeft") dc = -1;
    else if (event.key === "ArrowRight") dc = 1;
    else return;
    event.preventDefault();
    const col = Number(td.dataset.col);
    const row = Number(td.dataset.row);
    if (!Number.isFinite(col) || !Number.isFinite(row)) return;
    const target = tds && tds.get(keyOf(col + dc, row + dr));
    if (target) focusCell(target);
  }

  /**
   * Focus the first of the player's tokens. `say` is only used for the paths
   * where focus does not move — success focuses the cell, and the screen reader
   * reads it, so announcing on top of that would double it.
   */
  function focusMyToken(say) {
    if (!grid || !tds) {
      say("The map grid is not ready.");
      return;
    }
    const mine = myTokens();
    if (!mine.length) {
      say("You have no token on this map.");
      return;
    }
    const token = mine[0];
    const cell = cellOf(token, grid.snapTo);
    const td = tds.get(keyOf(cell.col, cell.row));
    if (!td) {
      say("Your token is outside the grid.");
      return;
    }
    if (document.activeElement === td) {
      // The cell is already focused, so `focus()` would be a no-op and the
      // screen reader would not re-read it. Announce its text instead so the
      // user still hears where they are.
      say(td.textContent);
      return;
    }
    focusCell(td);
    if (mine.length > 1) {
      // The focused cell is read by the screen reader already, so this only adds
      // the count rather than repeating the name and cell.
      say("You have " + mine.length + " characters on the map.");
    }
  }

  document.addEventListener(
    "keydown",
    (event) => {
      if (!myTokenKey(event)) return;
      event.preventDefault();
      focusMyToken(announce);
    },
    true
  );

  // Forwarded from the sheet frame. On success focus moves up here and the cell
  // is read; a failure leaves focus in the sheet, so the message goes back for
  // that frame to speak.
  window.addEventListener("message", (event) => {
    if (event.origin !== SHEET_ORIGIN) return;
    const data = event.data || {};
    if (!data.r20a11yMyToken) return;
    const source = event.source;
    focusMyToken((text) => {
      try {
        source.postMessage({ r20a11yMyTokenResult: text }, SHEET_ORIGIN);
      } catch (e) {
        /* frame unreachable; nothing was focused either way */
      }
    });
  });

  // --- Startup handshake -------------------------------------------------
  //
  // The bridge and this file load at document_idle in an undefined order. If
  // the bridge posted its snapshot before this listener was attached, it was
  // lost; announcing readiness until a grid actually builds lets the bridge
  // answer with a fresh snapshot and closes the race.

  let built = false;

  function announceReady() {
    if (built) return;
    try {
      window.postMessage({ r20a11yGridReady: true }, SELF_ORIGIN);
    } catch (e) {
      /* page world unreachable; nothing else to try */
    }
    window.setTimeout(announceReady, 500);
  }

  announceReady();
})();
