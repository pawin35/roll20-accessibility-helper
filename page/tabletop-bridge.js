/**
 * Feature: the accessible battle-grid bridge.
 *
 * *** This file runs in the PAGE's world, not the extension's. ***
 *
 * Registered with `"world": "MAIN"` in manifest.json, so it has no access to
 * `chrome.*`, `window.Roll20A11y`, or anything else the isolated world sets up.
 * It exists for one reason: the battle grid renders to an opaque WebGL canvas
 * with zero DOM, and the only route to the model — `Campaign`, token positions,
 * grid geometry, hit points — is the page world. The isolated world cannot see
 * any of it, so this script reads it and forwards state over
 * `window.postMessage` to `features/map-grid.js`.
 *
 * This is a *dumb* bridge on purpose. It owns data access and change
 * subscription, and forwards three verbs — an initial snapshot, a per-token
 * delta, and a token removal — plus the page geometry. All presentation (cell
 * references, facing, table text, phrasing) stays in the isolated world so
 * `page/` does not become a second codebase.
 *
 * Keep it self-contained: no globals from the rest of the extension.
 */
(function () {
  "use strict";

  // The page world persists across soft navigations and this file could be
  // injected more than once; wiring the same listeners twice double-posts.
  if (window.__r20a11yGridBridge) return;
  window.__r20a11yGridBridge = true;

  // Token attributes that, when they change, change what the grid shows.
  // `lastmove`, `z_index` and the selection state are deliberately absent: they
  // fire constantly during a drag and carry nothing a screen reader wants.
  var TRACKED = [
    "left", "top", "width", "height", "rotation", "name",
    "represents", "controlledby", "layer",
  ];

  function eachModel(collection, fn) {
    var models = collection && collection.models;
    if (!models) return;
    for (var i = 0; i < models.length; i++) fn(models[i]);
  }

  function post(data) {
    try {
      window.postMessage(data, "*");
    } catch (e) {
      /* same window, so there is nothing else to try */
    }
  }

  // --- Reading the model -------------------------------------------------

  /**
   * The file id of a files.d20.io URL — the path segment before the filename.
   * Used to recognise the map background: its `imgsrc` and the page's
   * `thumbnail` share this id (verified live, …/tKH66NDLvof2Axn_Sc2Efg/max.jpg
   * vs …/tKH66NDLvof2Axn_Sc2Efg/thumb.jpg). Nothing else on the map layer
   * matches, so it is a deterministic test where size and `represents` are not.
   */
  function fileIdOf(url) {
    var parts = String(url || "").split("/");
    if (parts.length < 2) return "";
    parts.pop(); // the filename (thumb.jpg / max.jpg)
    var id = parts.pop();
    return /^[A-Za-z0-9_-]+$/.test(id) ? id : "";
  }

  function isMapBackground(model, thumbnailId) {
    if (!thumbnailId) return false;
    return fileIdOf(model.get("imgsrc")) === thumbnailId;
  }

  /**
   * The background image, or null. Forwarded to the isolated world so the
   * terrain feature can fetch and resample it against the grid. The image is
   * CORS-clean (`access-control-allow-origin: *`) but is scaled: its natural
   * size differs from its `width`/`height` (world) footprint, so the placement
   * is sent alongside the URL rather than assumed 1:1.
   */
  function backgroundOf(page, thumbnailId) {
    var found = null;
    eachModel(page.thegraphics, function (model) {
      if (!found && isMapBackground(model, thumbnailId)) found = model;
    });
    if (!found) return null;
    return {
      imgsrc: found.get("imgsrc"),
      left: found.get("left"),
      top: found.get("top"),
      width: found.get("width"),
      height: found.get("height"),
    };
  }

  /**
   * Tokens the grid cares about: everything on the objects layer, plus
   * furniture on the map layer — but never the map background, and never the
   * GM-only layer (which players cannot see).
   */
  function isTracked(model, thumbnailId) {
    var layer = model.get("layer");
    if (layer === "objects") return true;
    if (layer === "map") return !isMapBackground(model, thumbnailId);
    return false;
  }

  // --- Hit points --------------------------------------------------------
  //
  // HP does not live on the token. The new advanced sheet stores a character's
  // whole state in an attribute literally named `store`, whose `current` value
  // is the sheet state object; hit points are at
  // `current.hitpoints.currentHP`. There is no stored maximum — the sheet
  // computes it from hit dice — so only current and temporary HP are read.
  //
  // Iterate `attribs.models` directly, not `attribs.each()`: the store loads
  // asynchronously over the socket and `each()` over an empty collection looks
  // identical to a broken selector, which cost a wrong conclusion once already.

  function storeModelOf(character) {
    var models = character && character.attribs && character.attribs.models;
    if (!models) return null;
    for (var i = 0; i < models.length; i++) {
      var attr = models[i].attributes || {};
      if (attr.name === "store") return models[i];
    }
    return null;
  }

  function hitPointsOf(character) {
    var store = storeModelOf(character);
    if (!store) return null;
    var current = store.get && store.get("current");
    if (!current || !current.hitpoints) return null;
    return current.hitpoints;
  }

  function characterOf(model) {
    var represents = model.get("represents");
    if (!represents) return null;
    return Campaign.characters.get(represents) || null;
  }

  /**
   * "Player character" = the represented character is controlled by someone.
   * NPCs leave `controlledby` empty. HP is shown only for player-controlled
   * characters, so a GM's secret monsters do not leak their hit points.
   */
  function isPlayerControlled(character) {
    return !!(character && character.get && character.get("controlledby"));
  }

  /** The current player's id, read lazily — it may not exist yet at load. */
  function currentPlayerId() {
    return window.currentPlayer && window.currentPlayer.id ? window.currentPlayer.id : "";
  }

  /**
   * "Mine" = this token is controlled by the player looking at the page. The
   * token's own `controlledby` is checked first, then the represented
   * character's. `"all"` does not count: it means everyone, not specifically me.
   */
  function isMine(model, character) {
    var me = currentPlayerId();
    if (!me) return false;
    var tokenCb = String(model.get("controlledby") || "").split(",");
    if (tokenCb.indexOf(me) >= 0) return true;
    var charCb = character ? String(character.get("controlledby") || "").split(",") : [];
    return charCb.indexOf(me) >= 0;
  }

  function tokenState(model, thumbnailId) {
    var character = characterOf(model);
    var controlled = isPlayerControlled(character);
    var hp = controlled ? hitPointsOf(character) : null;
    return {
      id: model.id,
      name: model.get("name") || "",
      represents: model.get("represents") || "",
      layer: model.get("layer") || "",
      left: model.get("left"),
      top: model.get("top"),
      width: model.get("width"),
      height: model.get("height"),
      rotation: model.get("rotation"),
      hp: hp && hp.currentHP != null ? hp.currentHP : null,
      tempHP: hp && hp.tempHP != null ? hp.tempHP : 0,
      playerControlled: controlled,
      mine: isMine(model, character),
    };
  }

  // --- Forwarding, coalesced --------------------------------------------
  //
  // A single gesture fires several change events (a drag sets left and top
  // together, and `lastmove` besides), so forwards are collapsed to one message
  // per token per tick rather than one per attribute. The token's state is read
  // at event time and carried in the message, so a flush never reads a model
  // that has since changed again.

  var pending = {};
  var flushTimer = null;

  function schedule(model, removed, page, thumbnailId) {
    var key = removed ? "-" + model.id : model.id;
    if (removed) {
      pending[key] = { removed: true, id: model.id, pageId: page.id };
    } else if (isTracked(model, thumbnailId)) {
      pending[key] = { token: tokenState(model, thumbnailId), pageId: page.id };
    }
    if (flushTimer !== null) return;
    flushTimer = window.setTimeout(flush, 0);
  }

  function flush() {
    flushTimer = null;
    for (var key in pending) {
      var item = pending[key];
      if (item.removed) {
        post({ r20a11yGridRemoved: { pageId: item.pageId, id: item.id } });
      } else {
        post({ r20a11yGridDelta: { pageId: item.pageId, token: item.token } });
      }
    }
    pending = {};
  }

  // --- Subscriptions -----------------------------------------------------

  function watchStore(character) {
    var store = storeModelOf(character);
    if (!store || store.__r20a11yWatched) return;
    store.__r20a11yWatched = true;
    // A change to the sheet state (HP, name, …) re-emits every token that
    // represents this character, so the grid stays in step with the sheet.
    store.on("change", function () {
      var page = Campaign.activePage();
      if (!page) return;
      var tid = fileIdOf(page.get("thumbnail"));
      eachModel(page.thegraphics, function (model) {
        if (model.get("represents") === character.id && isTracked(model, tid)) {
          schedule(model, false, page, tid);
        }
      });
    });
  }

  function watchCharacter(character) {
    if (!character) return;
    watchStore(character);
    // The store attribute can be created after the character first loads.
    if (character.attribs && character.attribs.on) {
      character.attribs.on("add", function (model) {
        if (model && model.attributes && model.attributes.name === "store") {
          watchStore(character);
        }
      });
    }
  }

  function watchAllCharacters() {
    eachModel(Campaign.characters, watchCharacter);
    Campaign.characters.on("add", watchCharacter);
  }

  function sendInit(page) {
    if (!page || !page.d20 || !page.d20.engine) return;
    var tid = fileIdOf(page.get("thumbnail"));
    var tokens = [];
    eachModel(page.thegraphics, function (model) {
      if (isTracked(model, tid)) tokens.push(tokenState(model, tid));
    });
    post({
      r20a11yGridInit: {
        pageId: page.id,
        width: Number(page.get("width")) || 0,
        height: Number(page.get("height")) || 0,
        snapTo: Number(page.d20.engine.snapTo) || 0,
        scaleNumber: page.get("scale_number"),
        scaleUnits: page.get("scale_units"),
        diagonaltype: page.get("diagonaltype"),
        background: backgroundOf(page, tid),
        tokens: tokens,
      },
    });
  }

  function wirePage(page) {
    if (!page || !page.thegraphics) return;
    var graphics = page.thegraphics;
    var tid = fileIdOf(page.get("thumbnail"));

    function onChange(model) {
      schedule(model, false, page, tid);
    }
    function onAdd(model) {
      schedule(model, false, page, tid);
    }
    function onRemove(model) {
      schedule(model, true, page, tid);
    }
    // Backbone's `fetch`/`set` populates a collection with a `reset`, not an
    // `add` — that is how the page's graphics arrive over the socket on load,
    // and a snapshot taken before it (with no tokens) would otherwise never be
    // corrected. Re-snapshot wholesale on reset.
    function onReset() {
      sendInit(page);
    }

    for (var i = 0; i < TRACKED.length; i++) {
      graphics.on("change:" + TRACKED[i], onChange);
    }
    graphics.on("add", onAdd);
    graphics.on("remove", onRemove);
    graphics.on("reset", onReset);

    sendInit(page);
  }

  // --- Boot --------------------------------------------------------------

  function start() {
    watchAllCharacters();
    wirePage(Campaign.activePage());
    // Switching pages re-parents thegraphics; re-wire and re-snapshot.
    Campaign.on("change:playerpageid", function () {
      wirePage(Campaign.activePage());
    });

    // Both this script and the isolated-world feature load at document_idle
    // with no guaranteed order. If this one wins, its first snapshot is posted
    // before the feature has attached its message listener and is lost, and the
    // table would never build. The feature re-announces "ready" until it has a
    // grid; answering that with a fresh snapshot closes the race.
    window.addEventListener("message", function (event) {
      if (event.origin !== "https://app.roll20.net") return;
      var data = event.data || {};
      if (data.r20a11yGridReady) {
        var page = Campaign.activePage();
        if (page) sendInit(page);
      }
    });

    // Defensive: if the graphics ever arrive by a route that fired neither
    // `add` nor `reset`, one late re-snapshot catches it. It is idempotent and
    // early enough not to disturb a user who has not yet reached the table.
    window.setTimeout(function () {
      var page = Campaign.activePage();
      if (page) sendInit(page);
    }, 1500);
  }

  // `Campaign` exists long before its pieces do: `Campaign.characters` and the
  // active page both arrive later over the socket. Polling only for `Campaign`
  // reached `.on` of an undefined `Campaign.characters` on first load.
  function ready() {
    if (!window.Campaign) return false;
    if (!Campaign.characters || typeof Campaign.characters.on !== "function") return false;
    if (typeof Campaign.activePage !== "function") return false;
    return true;
  }

  function poll() {
    if (!ready()) {
      window.setTimeout(poll, 100);
      return;
    }
    if (!Campaign.activePage()) {
      // The campaign loaded but no page is active yet; keep waiting.
      window.setTimeout(poll, 100);
      return;
    }
    start();
  }

  poll();
})();
