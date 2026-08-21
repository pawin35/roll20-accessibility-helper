/**
 * Feature: the character-model bridge.
 *
 * *** This file runs in the PAGE's world, not the extension's. ***
 *
 * Registered with `"world": "MAIN"` in manifest.json, so it has no access to
 * `chrome.*`, `window.Roll20A11y`, or anything else the isolated world sets up.
 * It exists because the D&D 2024 sheet keeps a character's entire state in a
 * Backbone attribute literally named `store`, reachable only through
 * `Campaign.characters` — a page-world object. The isolated world cannot see
 * any of it.
 *
 * Like `page/tabletop-bridge.js` this is a *dumb* bridge. It answers two
 * requests and does no interpretation:
 *
 *   r20a11yCharacterRequest  → r20a11yCharacterData    the raw integrants
 *   r20a11yOpenSheet         → r20a11yOpenSheetResult  open the sheet dialog
 *
 * All the arithmetic (ability modifiers, proficiency, save DCs, damage) lives
 * in `lib/character-rolls.js` in the isolated world, where it is a pure
 * function of the list posted here and can be regression-tested offline
 * against `test.json`. Nothing about presentation belongs in this file.
 *
 * Keep it self-contained: no globals from the rest of the extension.
 */
(function () {
  "use strict";

  // The page world persists across soft navigations and this file could be
  // injected more than once; wiring the same listener twice double-replies.
  if (window.__r20a11yCharacterBridge) return;
  window.__r20a11yCharacterBridge = true;

  var TOP_ORIGIN = "https://app.roll20.net";

  // The only integrant types the attack rows are derived from. Sending the
  // whole store would be ~100 KB of structured clone per keypress, nearly all
  // of it inventory, features and compendium prose that nothing here reads.
  var WANTED_TYPES = {
    "Attack": true,
    "Damage": true,
    "Ability Score": true,
    "Class Level": true,
    "Spell": true,
    "Spellcasting": true,
    // Item carries `weaponData` (training tier and weapon name) and Proficiency
    // carries what the character is trained in; together they decide whether an
    // attack adds the proficiency bonus.
    "Item": true,
    "Proficiency": true,
    // "Spell Slot" holds the per-level slot totals Roll20 itself uses.
    "Spell Slot": true,
  };

  var SHEET_FRAME_ID = "advanced-charsheet-dialog__charsheet";

  function post(data) {
    try {
      window.postMessage(data, "*");
    } catch (e) {
      /* same window, so there is nothing else to try */
    }
  }

  // --- Finding the character ---------------------------------------------

  function eachCharacter(fn) {
    var models =
      window.Campaign && Campaign.characters && Campaign.characters.models;
    if (!models) return;
    for (var i = 0; i < models.length; i++) fn(models[i]);
  }

  /** The current player's id, read lazily — it may not exist yet at load. */
  function currentPlayerId() {
    return window.currentPlayer && window.currentPlayer.id ? window.currentPlayer.id : "";
  }

  function isMine(character) {
    var me = currentPlayerId();
    if (!me) return false;
    return String(character.get("controlledby") || "").split(",").indexOf(me) >= 0;
  }

  /**
   * The character to act on.
   *
   * By name when the isolated world supplied one — it reads `#speakingas`, and
   * matching that keeps every roll shortcut agreeing on who is rolling. Falls
   * back to the player's own first controlled character (alphabetically, the
   * same rule `currentCharacterName` uses) so a missing or stale dropdown does
   * not make the shortcut dead.
   */
  function findCharacter(name) {
    var byName = null;
    var mine = [];
    eachCharacter(function (character) {
      if (name && !byName && character.get("name") === name) byName = character;
      if (isMine(character)) mine.push(character);
    });
    if (byName) return byName;
    if (!mine.length) return null;
    mine.sort(function (a, b) {
      return String(a.get("name") || "").localeCompare(String(b.get("name") || ""));
    });
    return mine[0];
  }

  /**
   * Iterate `attribs.models` directly, not `attribs.each()`: the store loads
   * asynchronously over the socket and `each()` over an empty collection looks
   * identical to a broken selector.
   */
  function storeOf(character) {
    var models = character && character.attribs && character.attribs.models;
    if (!models) return null;
    for (var i = 0; i < models.length; i++) {
      var attr = models[i].attributes || {};
      if (attr.name === "store") {
        return (models[i].get && models[i].get("current")) || null;
      }
    }
    return null;
  }

  /**
   * The wanted integrants, **in the store's own key order**.
   *
   * An array, not the object, and the order is load-bearing: Roll20's
   * `%{Name|repeating_attack_$N_attack}` indexes attacks in exactly this
   * sequence (verified live), and an array cannot lose that in transit.
   */
  function integrantsOf(store) {
    var table = store && store.integrants && store.integrants.integrants;
    if (!table) return null;
    var list = [];
    for (var key in table) {
      if (!table.hasOwnProperty(key)) continue;
      var it = table[key];
      if (it && WANTED_TYPES[it.type]) list.push(it);
    }
    return list;
  }

  // --- The character sheet dialog ----------------------------------------

  /**
   * Whether the sheet dialog is up.
   *
   * Roll20 mounts a second, id-less `advanced-sheets` iframe at 0x0 which is
   * present even with no sheet open, so the id *and* a real size are both
   * required.
   */
  function sheetIsOpen() {
    var frame = document.getElementById(SHEET_FRAME_ID);
    return !!(frame && (frame.offsetWidth || frame.offsetHeight));
  }

  /**
   * Open the sheet.
   *
   * `character.view.showDialog("sheet")`, not
   * `d20.engine.openCharacterForToken(id)` — the latter was verified live to
   * return without error and do nothing at all. (`window.d20` is undefined on
   * the VTT besides; it lives on `CharacterSheetsManagerSingleton.d20`.)
   */
  function openSheet(character) {
    if (!character || !character.view || !character.view.showDialog) return false;
    try {
      character.view.showDialog("sheet");
      return true;
    } catch (e) {
      return false;
    }
  }

  // --- Requests ----------------------------------------------------------

  /**
   * Roll20's own computed summary of the character, kept on the character model
   * as a JSON string: `{ hp: { current, max, temp }, ac: { total }, currency }`.
   *
   * This is where hit points and armour class come from. The alternative is to
   * recompute them — and maximum HP in particular is hit dice plus Constitution
   * plus every bonus, which the store does not hold in one place. It is also
   * what makes the readout work with the sheet closed: `@{Name|hp}` needs the
   * sheet worker running, and this does not.
   */
  function metaOf(character) {
    var raw = character.get("custom_meta1");
    if (!raw) return null;
    if (typeof raw === "object") return raw;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function handleCharacterRequest(request) {
    var reply = { requestId: request.requestId || "", name: "", integrants: null };
    var character = findCharacter(request.name);
    if (!character) {
      reply.error = "no-character";
      return post({ r20a11yCharacterData: reply });
    }
    reply.name = character.get("name") || "";

    var store = storeOf(character);
    var list = integrantsOf(store);
    if (!list) {
      reply.error = "no-store";
      return post({ r20a11yCharacterData: reply });
    }
    reply.integrants = list;
    // Top-level store keys, not integrants: how many slots are *left*, and the
    // live hit points. Totals are derived in the isolated world.
    reply.spellSlots = (store && store.spellSlots) || null;
    reply.hitpoints = (store && store.hitpoints) || null;
    reply.meta = metaOf(character);
    post({ r20a11yCharacterData: reply });
  }

  function handleOpenSheet(request) {
    if (sheetIsOpen()) {
      return post({ r20a11yOpenSheetResult: { state: "already" } });
    }
    var character = findCharacter(request.name);
    if (!character) {
      return post({ r20a11yOpenSheetResult: { state: "no-character" } });
    }
    if (!openSheet(character)) {
      return post({ r20a11yOpenSheetResult: { state: "failed" } });
    }
    post({ r20a11yOpenSheetResult: { state: "opening", name: character.get("name") || "" } });
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== TOP_ORIGIN) return;
    var data = event.data || {};
    if (data.r20a11yCharacterRequest) {
      handleCharacterRequest(data.r20a11yCharacterRequest);
    } else if (data.r20a11yOpenSheet) {
      handleOpenSheet(data.r20a11yOpenSheet);
    }
  });
})();
