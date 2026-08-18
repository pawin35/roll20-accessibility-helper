/**
 * Feature: on/off toggles for the VTT's spoken notifications.
 *
 *   alt+shift+-   token movement/change announcements   (default OFF)
 *   alt+shift+=   chat and roll readout from others     (default ON)
 *
 * Two kinds of automatic speech can be silenced: the battle grid's "moved to
 * …", "took damage: …" announcements (features/map-grid.js), and the chat's
 * readout of messages and rolls that come from other players
 * (features/vtt-chat.js). Both toggles persist in `chrome.storage.local` so
 * the choice survives a reload.
 *
 * The state lives in the VTT top frame, where both consumers run. The keys are
 * registered in both frames like every other shortcut: while focus is in the
 * floating character sheet the key is forwarded up, the top frame flips the
 * flag and posts the new state back for the sheet frame to speak.
 */
(function () {
  "use strict";

  const { announce } = window.Roll20A11y;

  const TOP_ORIGIN = "https://app.roll20.net";
  const SHEET_ORIGIN = "https://advanced-sheets.production.roll20preflight.net";

  // "tokens" | "others" | "", matched on `event.code` so a non-US layout works.
  function toggleKey(event) {
    if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return "";
    const code = event.code || "";
    if (code === "Minus") return "tokens";
    if (code === "Equal") return "others";
    return "";
  }

  // --- Sheet frame ------------------------------------------------------
  //
  // The floating character sheet is a cross-origin iframe; while focus is in it
  // the keydown never reaches the VTT document, so it is forwarded and the
  // result comes back here to be spoken. On the character-sheet page the parent
  // has no listener and the post goes nowhere.

  if (window.top !== window) {
    document.addEventListener(
      "keydown",
      (event) => {
        const kind = toggleKey(event);
        if (!kind) return;
        event.preventDefault();
        try {
          window.parent.postMessage({ r20a11yToggle: kind }, TOP_ORIGIN);
        } catch (e) {
          /* parent unreachable; nothing else this frame can do */
        }
      },
      true
    );

    window.addEventListener("message", (event) => {
      if (event.origin !== TOP_ORIGIN) return;
      const said = event.data && event.data.r20a11yToggleResult;
      if (typeof said === "string") announce(said);
    });

    return;
  }

  // --- Top frame --------------------------------------------------------

  const STORAGE_KEYS = {
    tokens: "r20a11yTokenChanges",
    others: "r20a11yOthersReadout",
  };

  const DEFAULTS = { tokens: false, others: true };

  const state = { tokens: DEFAULTS.tokens, others: DEFAULTS.others };

  // Read by features/map-grid.js and features/vtt-chat.js at event time, so the
  // flag is consulted live rather than captured at load.
  window.Roll20A11y.notifications = {
    isTokenChangesOn: () => state.tokens,
    isOthersReadoutOn: () => state.others,
  };

  function read() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(Object.keys(STORAGE_KEYS).map((k) => STORAGE_KEYS[k]), (data) => {
          resolve(data || {});
        });
      } catch (e) {
        resolve({});
      }
    });
  }

  function write(kind, value) {
    return new Promise((resolve) => {
      try {
        const obj = {};
        obj[STORAGE_KEYS[kind]] = value;
        chrome.storage.local.set(obj, resolve);
      } catch (e) {
        resolve();
      }
    });
  }

  // Load the persisted flags. Anything not stored keeps its default, so the
  // defaults hold until the storage round-trip completes.
  read().then((data) => {
    for (const kind of Object.keys(STORAGE_KEYS)) {
      const value = data[STORAGE_KEYS[kind]];
      if (typeof value === "boolean") state[kind] = value;
    }
  });

  function phrase(kind, on) {
    const word =
      kind === "tokens" ? "Token change announcements" : "Others' chat and roll readout";
    return word + (on ? " on." : " off.");
  }

  function toggle(kind, say) {
    state[kind] = !state[kind];
    write(kind, state[kind]);
    say(phrase(kind, state[kind]));
  }

  document.addEventListener(
    "keydown",
    (event) => {
      const kind = toggleKey(event);
      if (!kind) return;
      event.preventDefault();
      toggle(kind, announce);
    },
    true
  );

  // Forwarded from the sheet frame, which has focus — so it speaks, not us.
  window.addEventListener("message", (event) => {
    if (event.origin !== SHEET_ORIGIN) return;
    const kind = event.data && event.data.r20a11yToggle;
    if (kind !== "tokens" && kind !== "others") return;
    const source = event.source;
    toggle(kind, (text) => {
      try {
        source.postMessage({ r20a11yToggleResult: text }, SHEET_ORIGIN);
      } catch (e) {
        /* frame unreachable; the flag still flipped */
      }
    });
  });
})();
