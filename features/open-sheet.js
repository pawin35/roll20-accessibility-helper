/**
 * Feature: open the character sheet from the keyboard.
 *
 *   alt+shift+E   open the floating character sheet, and beep once it has loaded
 *
 * (alt+E was the obvious key and is not usable: it is Chrome's own accelerator
 * for the three-dot menu.)
 *
 * Opening is done by the page world — `page/character-bridge.js` calls
 * `character.view.showDialog("sheet")`. Note *not*
 * `d20.engine.openCharacterForToken(id)`, which the model notes recommend and
 * which was verified live to return without error and do nothing at all.
 *
 * "Loaded" is the sheet frame's own account of itself: it polls until its
 * document has laid out and rendered controls, then posts up. The top frame
 * also asks, because Roll20 reuses one iframe — reopening a sheet that has been
 * closed renders nothing new, so there would be no spontaneous report to wait
 * for. Whichever arrives first wins and the announcement happens once.
 *
 * The beep plays in **whichever frame the key was pressed**, so there is always
 * a real user gesture behind it, and the audio context is primed on the keydown
 * itself — by the time the sheet reports in, the trigger is a postMessage,
 * which is not a gesture.
 */
(function () {
  "use strict";

  const { announce, debug, primeAudio, currentCharacterName } = window.Roll20A11y;

  const TOP_ORIGIN = "https://app.roll20.net";
  const SHEET_ORIGIN = "https://advanced-sheets.production.roll20preflight.net";

  /** alt+shift+E, matched on `event.code` so a non-US layout still works. */
  function isOpenSheetKey(event) {
    if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return false;
    return event.code === "KeyE";
  }

  /**
   * A short rising two-tone blip, distinct from every other tone the extension
   * makes: 440/660 are the chat's log boundaries, 880 is a grid change, and
   * 660→880 is "Table ready."
   *
   * Synthesised rather than shipped as a file for the same reason as those: the
   * repo's sounds are roll flourishes, far too long to mark a moment.
   */
  function beep() {
    const audio = primeAudio();
    if (!audio || audio.state !== "running") return;
    try {
      const now = audio.currentTime;
      [784, 1047].forEach((freq, i) => {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const at = now + i * 0.1;
        // Ramped rather than switched on and off, which clicks audibly.
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.13, at + 0.01);
        gain.gain.linearRampToValueAtTime(0, at + 0.09);
        osc.connect(gain).connect(audio.destination);
        osc.start(at);
        osc.stop(at + 0.1);
      });
    } catch (e) {
      /* never let a missing tone stop the announcement */
    }
  }

  function report(say, withBeep) {
    if (withBeep) beep();
    if (say) announce(say);
  }

  // --- Sheet frame ------------------------------------------------------

  if (window.top !== window) {
    // (a) Report when this frame has finished rendering.
    //
    // Roll20 mounts *two* sheet iframes and one of them is a 0x0 ghost running
    // every one of these content scripts over a full duplicate of the markup.
    // A frame whose body has no size is that ghost and must never report.
    //
    // Beyond that the test is deliberately not tied to any Roll20 class name:
    // the sheet's own selectors move between deploys, and a wrong one here
    // would mean a beep that never comes. A laid-out document holding a
    // handful of controls is the sheet being usable, which is the actual
    // question being asked.
    const READY_POLL_MS = 250;
    const READY_CEILING_MS = 30000;
    let ready = false;

    function looksRendered() {
      const body = document.body;
      if (!body) return false;
      if (!body.offsetWidth && !body.offsetHeight) return false;
      return body.querySelectorAll("button, input, [role='button']").length >= 5;
    }

    function tellParent() {
      try {
        window.parent.postMessage({ r20a11ySheetLoaded: true }, TOP_ORIGIN);
      } catch (e) {
        /* parent unreachable; the top frame's own poll still covers it */
      }
    }

    // setTimeout, never requestAnimationFrame: rAF is paused entirely while the
    // tab is backgrounded, so an rAF poll would hang instead of timing out.
    const startedAt = Date.now();
    (function pollReady() {
      if (looksRendered()) {
        ready = true;
        debug("opensheet", "sheet frame rendered");
        tellParent();
        return;
      }
      if (Date.now() - startedAt > READY_CEILING_MS) return;
      window.setTimeout(pollReady, READY_POLL_MS);
    })();

    // (b) Forward the key, and speak the result here so the tone has a gesture.
    document.addEventListener(
      "keydown",
      (event) => {
        if (!isOpenSheetKey(event)) return;
        event.preventDefault();
        // While this keypress is still a user gesture: the reply that actually
        // triggers the tone arrives as a postMessage, which is not one.
        primeAudio();
        try {
          window.parent.postMessage({ r20a11yOpenSheetKey: true }, TOP_ORIGIN);
        } catch (e) {
          /* parent unreachable; nothing else this frame can do */
        }
      },
      true
    );

    window.addEventListener("message", (event) => {
      if (event.origin !== TOP_ORIGIN) return;
      const data = event.data || {};
      if (data.r20a11ySheetReadyQuery) {
        if (ready) tellParent();
        return;
      }
      const done = data.r20a11yOpenSheetDone;
      if (done) report(done.say, done.beep);
    });

    return;
  }

  // --- VTT top frame ----------------------------------------------------

  const SHEET_FRAME_ID = "advanced-charsheet-dialog__charsheet";
  const LOAD_POLL_MS = 500;
  const LOAD_CEILING_MS = 20000;

  // The sheet frame that forwarded the current press, or null when the key was
  // pressed here. Whichever frame it was is the one that speaks and beeps.
  let pendingSheet = null;

  function deliver(say, withBeep) {
    if (pendingSheet) {
      try {
        pendingSheet.postMessage(
          { r20a11yOpenSheetDone: { say, beep: !!withBeep } },
          SHEET_ORIGIN
        );
      } catch (e) {
        report(say, withBeep);
      }
      pendingSheet = null;
      return;
    }
    report(say, withBeep);
  }

  /** The visible sheet frame — never the 0x0 ghost Roll20 also mounts. */
  function sheetFrame() {
    const frame = document.getElementById(SHEET_FRAME_ID);
    if (frame && (frame.offsetWidth || frame.offsetHeight)) return frame;
    return null;
  }

  // One wait at a time; a second press while one is running is ignored rather
  // than starting a rival poll that would beep twice.
  let waiting = false;

  function waitForLoad() {
    if (waiting) return;
    waiting = true;
    const startedAt = Date.now();

    function finish(say, withBeep) {
      if (!waiting) return;
      waiting = false;
      window.removeEventListener("message", onLoaded);
      deliver(say, withBeep);
    }

    function onLoaded(event) {
      if (event.origin !== SHEET_ORIGIN) return;
      if (!(event.data && event.data.r20a11ySheetLoaded)) return;
      debug("opensheet", "sheet reported loaded");
      finish("Character sheet open.", true);
    }
    window.addEventListener("message", onLoaded);

    (function poll() {
      if (!waiting) return;
      // Ask an already-rendered frame to say so. Roll20 reuses one iframe, so
      // reopening a closed sheet renders nothing new and posts nothing new.
      const frame = sheetFrame();
      if (frame && frame.contentWindow) {
        try {
          frame.contentWindow.postMessage({ r20a11ySheetReadyQuery: true }, SHEET_ORIGIN);
        } catch (e) {
          /* the frame will report on its own if it can */
        }
      }
      if (Date.now() - startedAt > LOAD_CEILING_MS) {
        debug("opensheet", "gave up waiting for the sheet");
        finish("Character sheet did not finish loading.", false);
        return;
      }
      window.setTimeout(poll, LOAD_POLL_MS);
    })();
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== TOP_ORIGIN) return;
    const result = event.data && event.data.r20a11yOpenSheetResult;
    if (!result) return;
    if (result.state === "opening") {
      waitForLoad();
      return;
    }
    if (result.state === "already") {
      deliver("Character sheet is already open.", false);
      return;
    }
    if (result.state === "no-character") {
      deliver("You have no character sheet to open.", false);
      return;
    }
    deliver("Could not open the character sheet.", false);
  });

  function doOpen(source) {
    if (waiting) {
      // Answer in the frame that pressed *this* time, and leave `pendingSheet`
      // owned by the press that is still being waited on.
      if (source) {
        try {
          source.postMessage(
            { r20a11yOpenSheetDone: { say: "Character sheet is still opening.", beep: false } },
            SHEET_ORIGIN
          );
          return;
        } catch (e) {
          /* fall through and say it here */
        }
      }
      report("Character sheet is still opening.", false);
      return;
    }
    pendingSheet = source || null;
    try {
      window.postMessage(
        { r20a11yOpenSheet: { name: currentCharacterName() } },
        TOP_ORIGIN
      );
    } catch (e) {
      deliver("Could not open the character sheet.", false);
    }
  }

  document.addEventListener(
    "keydown",
    (event) => {
      if (!isOpenSheetKey(event)) return;
      event.preventDefault();
      primeAudio();
      doOpen(null);
    },
    true
  );

  window.addEventListener("message", (event) => {
    if (event.origin !== SHEET_ORIGIN) return;
    if (!(event.data && event.data.r20a11yOpenSheetKey)) return;
    doOpen(event.source);
  });
})();
