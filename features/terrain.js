/**
 * Feature: identify the map's terrain per grid cell with Gemini.
 *
 * The battle grid tells a screen reader *what is where* — a token and its hit
 * points — but not what the token stands *on*. This feature asks a Gemini model
 * to look at the page's background image and label every grid cell with a short
 * terrain phrase ("sand", "wooden deck", "stone pillar"), then hands the labels
 * to `features/map-grid.js` so an empty cell reads "sand, A1" instead of
 * "blank, A1" and a token cell reads "… facing west, on wooden deck, F4".
 *
 * The button lives in the map-grid section (screen-reader-only, like the rest
 * of it) and is pressed on demand — nothing is fetched until then. The API key
 * is asked for once with `window.prompt` and kept in `chrome.storage.local`,
 * which is isolated-world-only, so the page cannot read it. The key is cleared
 * when Google rejects it so the next press re-prompts.
 *
 * The image is resampled onto the page grid first: its natural size differs
 * from its world footprint (verified 1249x2048 placed at 1068x1750), so drawing
 * it at its `left/top/width/height` placement into a page-size canvas is what
 * makes one canvas pixel equal one world pixel. Only whole cells fully inside
 * the image are cropped and sent; the rest stay "blank".
 *
 * Gemini's structured output is used: `response_mime_type: application/json`
 * plus a `response_schema` describing a fixed R x C array of strings, so the
 * reply is valid JSON that maps straight onto the grid.
 */
(function () {
  "use strict";

  const { CLASS_PREFIX, announce, debug } = window.Roll20A11y;

  // The user asked for exactly this model; 2.5 Flash-Lite is retired.
  const MODEL = "gemini-3.5-flash-lite";
  const API =
    "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent";

  // Each grid cell is downscaled to this many pixels before being sent, so a
  // 25x25 map becomes a small image regardless of its native resolution.
  const CELL_PX = 32;

  const KEY_NAME = "r20a11yGeminiKey";

  // State. `labels` holds "col:row" -> terrain phrase for the covered region
  // only; anything absent reads as blank.
  let labels = null;
  let deps = null; // { section, reRender, getBackground, getGrid }
  let running = false;

  // --- Storage -----------------------------------------------------------

  function readKey() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(KEY_NAME, (data) => resolve((data && data[KEY_NAME]) || ""));
      } catch (e) {
        resolve("");
      }
    });
  }

  function writeKey(key) {
    return new Promise((resolve) => {
      try {
        const obj = {};
        obj[KEY_NAME] = key;
        chrome.storage.local.set(obj, resolve);
      } catch (e) {
        resolve();
      }
    });
  }

  function clearKey() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.remove(KEY_NAME, resolve);
      } catch (e) {
        resolve();
      }
    });
  }

  /**
   * The stored key, or a freshly prompted one. `null` means "give up": the
   * prompt was cancelled or left empty. Prompting happens here in the top
   * frame, where `window.prompt` is allowed (it is blocked outright inside a
   * cross-origin iframe, but this feature only runs in the VTT top frame).
   */
  async function obtainKey() {
    const existing = await readKey();
    if (existing) return existing;

    let entered = null;
    try {
      entered = window.prompt("Enter your Gemini API key:");
    } catch (e) {
      announce("Could not open the API key prompt.");
      return null;
    }
    if (entered === null || !entered.trim()) return null;
    const key = entered.trim();
    await writeKey(key);
    return key;
  }

  // --- Image resampling --------------------------------------------------

  /**
   * Fetch the background, draw it into a page-size canvas at its world
   * placement, then crop the covered whole cells and downscale. Returns the
   * JPEG data URL and the covered region's origin and size.
   */
  async function imageToGrid(bg, grid) {
    const res = await fetch(bg.imgsrc, { mode: "cors" });
    if (!res.ok) throw new Error("background image fetch failed (" + res.status + ")");
    const bitmap = await createImageBitmap(await res.blob());

    const snapTo = grid.snapTo;
    const page = document.createElement("canvas");
    page.width = grid.width * snapTo;
    page.height = grid.height * snapTo;
    const pctx = page.getContext("2d");
    // top-left is centre minus half size, since left/top are the centre.
    pctx.drawImage(
      bitmap,
      bg.left - bg.width / 2,
      bg.top - bg.height / 2,
      bg.width,
      bg.height
    );

    // Whole cells fully inside the image only; a partially covered cell would
    // carry transparent slivers that a JPEG turns black.
    const colStart = Math.ceil((bg.left - bg.width / 2) / snapTo);
    const colEnd = Math.floor((bg.left + bg.width / 2) / snapTo) - 1;
    const rowStart = Math.ceil((bg.top - bg.height / 2) / snapTo);
    const rowEnd = Math.floor((bg.top + bg.height / 2) / snapTo) - 1;
    const nCols = Math.max(0, colEnd - colStart + 1);
    const nRows = Math.max(0, rowEnd - rowStart + 1);
    if (!nCols || !nRows) throw new Error("the background image covers no whole cell");

    const crop = document.createElement("canvas");
    crop.width = nCols * CELL_PX;
    crop.height = nRows * CELL_PX;
    const cctx = crop.getContext("2d");
    cctx.drawImage(
      page,
      colStart * snapTo,
      rowStart * snapTo,
      nCols * snapTo,
      nRows * snapTo,
      0,
      0,
      crop.width,
      crop.height
    );

    return {
      dataUrl: crop.toDataURL("image/jpeg", 0.85),
      colStart,
      rowStart,
      nCols,
      nRows,
    };
  }

  // --- Gemini ------------------------------------------------------------

  function isAuthFailure(err) {
    const api = err && err.apiStatus;
    if (api === "INVALID_ARGUMENT" || api === "PERMISSION_DENIED" || api === "UNAUTHENTICATED") {
      return true;
    }
    const http = err && err.httpStatus;
    return http === 400 || http === 401 || http === 403;
  }

  async function callGemini(key, region) {
    const base64 = region.dataUrl.slice(region.dataUrl.indexOf(",") + 1);
    const prompt =
      "You are looking at a top-down tabletop battle map divided into a grid of " +
      region.nRows + " rows by " + region.nCols +
      " columns of equal square cells. For every cell, give the terrain or material " +
      "it shows as one short lowercase phrase of at most three words (for example " +
      '"sand", "wooden deck", "stone pillar", "water", "grass"). Use "blank" for a ' +
      "cell that is empty, transparent, or has no distinct surface. Return a JSON " +
      "array of " + region.nRows + " arrays, each of " + region.nCols +
      " strings, in row-major order from the top row to the bottom row.";

    const body = {
      contents: [
        {
          parts: [
            { text: prompt },
            { inline_data: { mime_type: "image/jpeg", data: base64 } },
          ],
        },
      ],
      generationConfig: {
        response_mime_type: "application/json",
        response_schema: {
          type: "ARRAY",
          items: {
            type: "ARRAY",
            items: { type: "STRING" },
            minItems: region.nCols,
            maxItems: region.nCols,
          },
          minItems: region.nRows,
          maxItems: region.nRows,
        },
      },
    };

    const res = await fetch(API + "?key=" + encodeURIComponent(key), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    let rawBody = "";
    let json = null;
    try {
      rawBody = await res.text();
      json = rawBody ? JSON.parse(rawBody) : null;
    } catch (e) {
      /* non-JSON error body; rawBody still holds it */
    }

    if (!res.ok) {
      const apiError = json && json.error;
      const err = new Error(
        "HTTP " + res.status +
          (apiError && apiError.status ? ", " + apiError.status : "") +
          (apiError && apiError.message ? ": " + apiError.message : "")
      );
      err.httpStatus = res.status;
      err.apiStatus = apiError && apiError.status;
      err.apiMessage = apiError && apiError.message;
      err.body = rawBody;
      throw err;
    }

    const candidate = json && json.candidates && json.candidates[0];
    const part =
      candidate &&
      candidate.content &&
      candidate.content.parts &&
      candidate.content.parts[0];
    const text = part && part.text;
    if (!text) throw new Error("Gemini returned no text");
    return text;
  }

  /**
   * Parse the structured JSON reply into a Map keyed "col:row". Defensive on
   * every axis: markdown fences are stripped, and a reply with the wrong
   * dimensions is truncated/padded rather than trusted blindly.
   */
  function parseLabels(text, region) {
    const cleaned = String(text).replace(/```json|```/g, "");
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start < 0 || end <= start) throw new Error("no JSON array in the reply");
    const arr = JSON.parse(cleaned.slice(start, end + 1));
    if (!Array.isArray(arr)) throw new Error("reply was not an array");

    const map = new Map();
    const rows = Math.min(arr.length, region.nRows);
    for (let r = 0; r < rows; r++) {
      const rowArr = Array.isArray(arr[r]) ? arr[r] : [];
      for (let c = 0; c < region.nCols; c++) {
        const raw = rowArr[c];
        const label = typeof raw === "string" ? raw.trim().toLowerCase() : "";
        map.set(region.colStart + c + ":" + (region.rowStart + r), label || "blank");
      }
    }
    return map;
  }

  // --- The button action -------------------------------------------------

  async function identify() {
    if (running) return;
    const bg = deps.getBackground();
    if (!bg || !bg.imgsrc) {
      announce("No background image to identify.");
      return;
    }
    const grid = deps.getGrid();
    if (!grid || !grid.snapTo) return;

    const key = await obtainKey();
    if (!key) return;

    running = true;
    announce("Identifying terrain.");

    try {
      const region = await imageToGrid(bg, grid);
      debug("terrain", "sent a " + region.nCols + "x" + region.nRows + " crop");
      const text = await callGemini(key, region);
      labels = parseLabels(text, region);
      deps.reRender();
      announce("Terrain identified for the grid.");
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      const full =
        message + (err && err.body ? " — response: " + err.body : "");
      debug("terrain", full);
      // Content-script console messages do not reach the automation tooling, but
      // they do appear in the page's DevTools console for the user, and the raw
      // body is often the only thing that says *why* a request was rejected.
      console.error("[r20a11y terrain]", full);
      if (isAuthFailure(err)) {
        await clearKey();
        announce("Terrain identification failed: the API key was rejected. " + message + ".");
      } else {
        announce("Terrain identification failed. " + message + ".");
      }
    } finally {
      running = false;
    }
  }

  // --- Public hook -------------------------------------------------------

  /**
   * Attach the button and remember how to reach the grid. Called once by
   * `features/map-grid.js` after its section first exists; `section` persists
   * across page switches (only its table is rebuilt), so the button stays put.
   */
  function bind(bindings) {
    if (deps) {
      deps = bindings;
      return;
    }
    deps = bindings;
    const button = document.createElement("button");
    button.type = "button";
    button.className = CLASS_PREFIX + "-btn";
    button.textContent = "Identify terrain";
    button.addEventListener("click", identify);
    const table = deps.section.querySelector("table");
    deps.section.insertBefore(button, table);
  }

  function labelAt(col, row) {
    return labels ? labels.get(col + ":" + row) || "" : "";
  }

  /** Drop the labels, e.g. when the active page changes. */
  function reset() {
    labels = null;
  }

  window.Roll20A11y.terrain = { bind, labelAt, reset };
})();
