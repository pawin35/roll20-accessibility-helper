/**
 * Feature: the VTT text chat, read one line at a time.
 *
 *   alt+[         previous message         alt+shift+[   first message
 *   alt+]         next message             alt+shift+]   last message
 *   alt+O         re-read the current one
 *   alt+shift+C   type a message and send it
 *
 * None of these ever move focus. They speak, and that is all.
 *
 * --- What was wrong --------------------------------------------------------
 *
 * `#textchat > .content` already carries `aria-live="polite"` — that is
 * Roll20's, not ours, and it is what reads new chat aloud today. The trouble is
 * that it announces the raw subtree, and a Roll20 message is not built to be
 * read straight through:
 *
 *   Brother Lorian / Initiative / 7 / 2 / Details / rolling 2d8+3( / 7 / 0 /
 *   + / 4 / 0 / )+3=14 / izatea (GM):...
 *
 * Three separate causes, all of them fixed here rather than worked around:
 *
 *   - a `.diceroll` is a `.didroll` (the value) next to a `.backing` (a glyph
 *     from the dice font, whose text is junk). Both get read.
 *   - `.by` — the sender — is only rendered on the **first** message of a run.
 *     Roll20 groups consecutive messages from one speaker and drops it from the
 *     rest, so most messages are read with no idea who said them.
 *   - a roll's numbers are spread over a `rolltemplate` with a collapsed
 *     `<details>`, which reads as a column of bare digits.
 *
 * So each message is collapsed to a single line: everything Roll20 rendered is
 * `aria-hidden`, and one visually-hidden span holding the line is appended.
 * Nothing moves and nothing changes on screen; the accessibility tree just
 * stops containing the pile. Roll20's own live region is switched off, and the
 * line is announced from ours once it has actually been built — otherwise the
 * two race, and the raw version usually wins.
 *
 * The trade this makes: anything interactive inside a message (a link, the
 * "Details" disclosure) is inside what gets hidden, and is no longer reachable
 * by a screen reader. That is deliberate — the point is one line per message —
 * but it is the thing to undo first if it turns out to matter.
 *
 * --- Where the roll parsing lives ------------------------------------------
 *
 * A sheet roll here is `.message > .sheetroll > rolltemplate.dnd-2024`, and the
 * template is identical to the one in the character sheet's Roll Log. It is
 * read by `lib/roll-format.js`, shared with `features/last-result.js`. Only the
 * chat-specific shapes — the sender, the `/roll` dice — are this file's.
 */
(function () {
  "use strict";

  const {
    CLASS_PREFIX,
    debug,
    announce,
    enhance,
    markOnce,
    hiddenSpan,
    normalize,
    primeAudio,
    isReadKey,
    markReady,
    rollFormat,
  } = window.Roll20A11y;
  const { textOf, describeTemplate, judge, critKindFromTemplate } = rollFormat;

  const TOP_ORIGIN = "https://app.roll20.net";
  const SHEET_ORIGIN = "https://advanced-sheets.production.roll20preflight.net";

  /**
   * "prev" | "next" | "first" | "last" | "reread" | "send", or "".
   *
   * Matched on `event.code`, not `event.key`: with alt (and often shift) held,
   * `key` is whatever the layout produces, and the brackets in particular are
   * somewhere else entirely on a non-US keyboard.
   */
  function chatKey(event) {
    if (!event.altKey || event.ctrlKey || event.metaKey) return "";
    const code = event.code || "";
    if (code === "BracketLeft") return event.shiftKey ? "first" : "prev";
    if (code === "BracketRight") return event.shiftKey ? "last" : "next";
    if (code === "KeyC" && event.shiftKey) return "send";
    if (code === "KeyR" && event.shiftKey) return "rollprompt";
    // The dice keys are the *unshifted* digits. alt+shift+<n> is already the
    // sidebar tab shortcut in features/vtt-sidebar-tabs.js, which is why that
    // one insists on shift and this one insists on its absence — between them
    // the digits are unambiguous.
    if (!event.shiftKey && DICE[code]) return "roll:" + DICE[code];
    return "";
  }

  /** alt+1 … alt+7 — the standard polyhedral set, in the usual order. */
  const DICE = {
    Digit1: "1d4",
    Digit2: "1d6",
    Digit3: "1d8",
    Digit4: "1d10",
    Digit5: "1d12",
    Digit6: "1d20",
    Digit7: "1d100",
  };

  /** The formula behind a "roll:<formula>" kind, or "" for anything else. */
  function dieOf(kind) {
    return kind.indexOf("roll:") === 0 ? kind.slice(5) : "";
  }

  const NAV_KINDS = ["prev", "next", "first", "last", "reread"];

  // --- The edge tone ----------------------------------------------------
  //
  // Played when a step lands on the first or last message and cannot go
  // further. Synthesised rather than shipped as a file: the repo's existing
  // sounds are roll flourishes, far too long and too thematic to serve as a
  // boundary marker, and an oscillator costs no asset and lets the two ends
  // have different pitches — low for the start of the log, high for the end.
  //
  // It plays in whichever frame the key was pressed, never across the frame
  // boundary, so there is always a real user gesture behind it.

  function beep(edge) {
    const audio = primeAudio();
    if (!audio) return;
    try {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = edge === "start" ? 440 : 660;
      // Ramped rather than switched on and off, which clicks audibly.
      const at = audio.currentTime;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.12, at + 0.01);
      gain.gain.linearRampToValueAtTime(0, at + 0.12);
      osc.connect(gain).connect(audio.destination);
      osc.start(at);
      osc.stop(at + 0.13);
    } catch (e) {
      /* as above — never let a missing tone stop the announcement */
    }
  }

  // --- Sheet frame ------------------------------------------------------
  //
  // The floating character sheet is a cross-origin iframe: while focus is in
  // it, none of these keydowns reach the VTT document. They are forwarded, the
  // top frame acts, and the outcome comes back here to be spoken — because
  // focus never moves, so this frame is still where the user is.
  //
  // alt+O is deliberately absent: `features/last-result.js` already forwards it
  // from this frame as `r20a11yReannounce`, and the top frame below answers
  // that message. Registering it twice would post it twice.
  //
  // On the character-sheet page the parent has no listener for any of this and
  // the posts simply go nowhere, so there is no page check to make.

  if (window.top !== window) {
    // Where focus was when the key was pressed. Only alt+shift+C needs it: the
    // top frame has to focus the chat box to send, and pulling focus back up
    // there only restores it as far as the <iframe> element. This frame puts it
    // back on the actual control inside.
    let returnTo = null;

    function restore() {
      if (
        returnTo &&
        returnTo.isConnected &&
        returnTo !== document.body &&
        document.activeElement !== returnTo &&
        returnTo.focus
      ) {
        returnTo.focus();
      }
      returnTo = null;
    }

    document.addEventListener(
      "keydown",
      (event) => {
        const kind = chatKey(event);
        if (!kind) return;
        event.preventDefault();
        // While this keypress is still a user gesture, in case the reply comes
        // back asking for an edge tone.
        primeAudio();
        try {
          const die = dieOf(kind);
          if (die) {
            // Sending focuses the chat box up there, so this frame has to put
            // focus back afterwards, exactly as for alt+shift+C.
            returnTo = document.activeElement;
            window.parent.postMessage({ r20a11yChatRoll: die }, TOP_ORIGIN);
          } else if (kind === "send") {
            returnTo = document.activeElement;
            // The prompt is raised up there, not here: Chrome blocks
            // `prompt()` inside a cross-origin iframe outright, and a blocked
            // one just returns null with nothing shown.
            window.parent.postMessage({ r20a11yChatPrompt: true }, TOP_ORIGIN);
          } else if (kind === "rollprompt") {
            returnTo = document.activeElement;
            window.parent.postMessage({ r20a11yChatRollPrompt: true }, TOP_ORIGIN);
          } else {
            window.parent.postMessage({ r20a11yChatNav: kind }, TOP_ORIGIN);
          }
        } catch (e) {
          /* parent unreachable; nothing else this frame can do */
        }
      },
      true
    );

    window.addEventListener("message", (event) => {
      if (event.origin !== TOP_ORIGIN) return;
      const said = event.data && event.data.r20a11yChatResult;
      if (typeof said !== "string") return;
      restore();
      // The top frame decided this was an edge; the tone belongs here, where
      // the user is.
      const edge = event.data.r20a11yChatEdge;
      if (edge === "start" || edge === "end") beep(edge);
      // An empty result means "focus is yours again, and there is nothing to
      // report" — a die shortcut that worked. The roll sound already confirmed
      // it and the result itself follows in a moment, so saying "Sent." on top
      // of both would be three notifications for one keypress.
      if (said) announce(said);
    });

    return;
  }

  // --- Top frame --------------------------------------------------------

  const SEL_LOG = "#textchat .content";
  const SEL_MESSAGE = "#textchat .content > .message";
  // Roll20 parks two things in the log that are not chat: an empty `news`
  // banner and a static "Chat Tips" block, both of which sit at the end and
  // would otherwise be what alt+shift+] lands on every time. Neither carries a
  // `data-messageid` and every one of the 40 real messages in the test campaign
  // does, so that is the test — furniture is still collapsed to one line so it
  // reads tidily if you browse past it, but the cursor steps over it and it is
  // never announced.
  const SEL_CHAT = SEL_MESSAGE + "[data-messageid]";
  const SEL_INPUT = "#textchat-input textarea";
  const SEL_SEND = "#chatSendBtn";
  const LINE_CLASS = CLASS_PREFIX + "-chat-line";

  // Long enough for Roll20 to finish rendering a roll's numbers, short enough
  // not to feel laggy. Also the window over which a burst — an attack and its
  // damage arriving together — is gathered into one announcement rather than
  // two interruptions. Same value and same reasoning as last-result.js.
  const SETTLE_MS = 150;
  // Roll20 replays the campaign's chat history into the log at startup. Those
  // are collapsed like anything else, but announcing them would mean sitting
  // through the entire backlog on every page load, so nothing is spoken until
  // the log has had time to fill. Getting this wrong in either direction is
  // survivable: too short reads some history once, too long drops the first
  // message of a session.
  // Nothing is announced or sounded until the log has gone *quiet* for this
  // long. A fixed delay measured from script load does not work, and this is
  // the second attempt: Roll20 streams the campaign's chat history in over its
  // socket, and on anything but a fast connection that lands well after any
  // timer worth picking — so a refresh replayed a crit fanfare for every
  // historic roll. Every message seen while still priming pushes the deadline
  // back, so the gate opens when the backlog actually stops, however long that
  // takes.
  const PRIME_QUIET_MS = 2000;
  // ...unless the table is talking non-stop from the moment the page loads, in
  // which case waiting for silence would wait forever.
  const PRIME_MAX_MS = 20000;
  const SWEEP_MS = 500;
  // More messages than this landing at once is history, not conversation.
  const BULK_LIMIT = 5;

  // --- Reading a message ------------------------------------------------

  /**
   * Who said it.
   *
   * `.by` is rendered only on the first message of a run — Roll20 groups
   * consecutive messages from one speaker and omits it from the rest — so a
   * message without one inherits from the nearest earlier message that has one.
   * That is also why this walks the DOM rather than caching: the earlier
   * message is always still there.
   */
  function senderOf(msg) {
    for (let node = msg; node; node = node.previousElementSibling) {
      if (!node.classList || !node.classList.contains("message")) continue;
      const by = node.querySelector(".by");
      // Trailing colon stripped: Roll20 renders "Punnaphoj:" and the line puts
      // its own punctuation in.
      if (by) return normalize(by.textContent).replace(/:\s*$/, "");
    }
    return "";
  }

  /** Everything Roll20's chrome contributes, none of which is the message. */
  const SEL_CHROME = ".by, .tstamp, .avatar, .spacer, .clear, .backing";

  /** The message's own text, with the chrome and our own lines taken out. */
  function bodyText(msg) {
    const clone = msg.cloneNode(true);
    clone
      .querySelectorAll(SEL_CHROME + ", ." + LINE_CLASS)
      .forEach((node) => node.remove());
    // `textContent` puts no separator at an element boundary, so a message
    // built out of block elements comes back welded together — Roll20's own
    // "Chat Tips" notice read as "Chat TipsType these chat commands". A space
    // after every element is enough; `normalize` collapses the surplus.
    clone.querySelectorAll("*").forEach((el) => el.appendChild(document.createTextNode(" ")));
    return normalize(clone.textContent);
  }

  /**
   * A `/roll` or an inline roll — `.message.rollresult`, which has no
   * `rolltemplate` and a shape of its own:
   *
   *   .formula                     "rolling 2d8+3"
   *   .formula.formattedformula
   *     .dicegrouping
   *       .diceroll > .dicon > .didroll   the value of one die
   *                          > .backing   a dice-font glyph, read as noise
   *   strong                       "="
   *   .rolled                      the total
   *
   * `.didroll` is read and `.backing` is not, which is where the stray digits
   * in the raw reading came from.
   */
  function readDiceRoll(msg) {
    // The first `.formula` is the plain one; the second is the formatted copy
    // with the dice inside it, and reading both says the formula twice.
    const formula = textOf(msg, ".formula");
    const dice = Array.prototype.map
      .call(msg.querySelectorAll(".didroll"), (die) => normalize(die.textContent))
      .filter(Boolean);
    const total = textOf(msg, ".rolled");

    const parts = [];
    if (formula) parts.push(formula);
    if (dice.length) parts.push("dice " + dice.join(" and "));
    if (total) parts.push("total " + total);
    if (!parts.length) return "";
    return parts.join(", ") + ".";
  }

  function prefixed(who, text) {
    return who ? who + ": " + text : text;
  }

  /**
   * The one line to speak for a message.
   *
   * Every branch ends in the raw text rather than a failure message when it
   * does not recognise what it is looking at: an ugly line is never worse than
   * what Roll20 says today, and a message silently dropped would be.
   */
  function describeMessage(msg) {
    const cls = msg.classList;

    // Roll20's own notices — no sender, and the body is the whole message.
    if (cls.contains("system") || cls.contains("news")) {
      const text = bodyText(msg);
      return text ? "System. " + text : "";
    }

    const sender = senderOf(msg);

    const template = msg.querySelector("rolltemplate");
    if (template) {
      const said = describeTemplate(template);
      if (said) {
        // Who rolled it is named twice over: `.by` is the Roll20 account, and
        // the template's own `.meta__character-name` is the character. Which
        // one `.by` holds depends on what `#speakingas` was set to, so on its
        // own it is "Punnaphoj" sometimes and "Brother Lorian" others.
        //
        // The character is the useful one — it is who acted in the fiction, and
        // it is the same name every time regardless of that setting. The
        // account name is only a fallback for a roll with no character behind
        // it. (`describeTemplate` strips `.meta`, so this is read off `msg`.)
        const who = textOf(msg, ".meta__character-name") || sender;
        return prefixed(who, said);
      }
    }

    if (cls.contains("rollresult")) {
      const said = readDiceRoll(msg);
      if (said) return prefixed(sender, said);
    }

    const text = bodyText(msg);
    if (!text) return "";
    if (cls.contains("emote")) return text;
    if (cls.contains("whisper")) {
      return sender ? "Whisper from " + sender + ": " + text : "Whisper: " + text;
    }
    return prefixed(sender, text);
  }

  // --- Collapsing it to that line ---------------------------------------

  function ourLine(text) {
    const span = hiddenSpan(text);
    span.classList.add(LINE_CLASS);
    return span;
  }

  /** The lines we put on a message, which is what any shortcut speaks. */
  function readLines(msg) {
    return Array.prototype.map.call(
      msg.querySelectorAll("." + LINE_CLASS),
      (span) => span.textContent
    );
  }

  /**
   * Hide everything Roll20 rendered and append our line.
   *
   * A general message's body is a **bare text node** directly under `.message`,
   * and a text node cannot carry `aria-hidden`, so it gets a wrapper. Nothing
   * is removed and nothing is restyled: the message looks exactly the same, it
   * just no longer contributes its pieces to the accessibility tree.
   */
  function collapse(msg, line) {
    for (const child of Array.prototype.slice.call(msg.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (child.classList && child.classList.contains(LINE_CLASS)) continue;
        if (child.getAttribute("aria-hidden") !== "true") {
          child.setAttribute("aria-hidden", "true");
        }
      } else if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) {
        const wrapper = document.createElement("span");
        wrapper.setAttribute("aria-hidden", "true");
        msg.insertBefore(wrapper, child);
        wrapper.appendChild(child);
      }
    }
    if (line) msg.appendChild(ourLine(line));
  }

  // --- Sounds for other people's rolls ----------------------------------
  //
  // Roll20's own beep is suppressed for rolls by page/suppress-roll-beep.js, so
  // this is what a roll sounds like now. Three rules, and the first one wins:
  //
  //   a natural 20 or 1   its fanfare, no matter whose roll it was
  //   your own roll       nothing — you were there when you pressed the button,
  //                       and the sheet frame has already played a roll sound
  //                       on the press itself
  //   anyone else's roll  other-roll.mp3, so a roll arriving from the table is
  //                       audibly not one of yours
  //
  // Whose message it is comes from Roll20's own `you` class, which it puts on
  // every message you sent — verified against the test campaign, where the GM's
  // messages carry only `player--<id>` and never `you`.

  const SOUNDS = {
    roll: "sounds/roll.mp3",
    crit: "sounds/natural-20.mp3",
    fail: "sounds/natural-1.mp3",
    other: "sounds/other-roll.mp3",
  };

  // A flurry of rolls should not become a queue that plays for ten seconds.
  const MAX_QUEUE = 3;
  const soundQueue = [];
  let playingSound = false;

  function playNextSound() {
    if (playingSound) return;
    const key = soundQueue.shift();
    if (!key) return;
    const path = SOUNDS[key];
    // Keyed lookup, never a path taken from the message, so nothing that
    // arrives over the wire can name a file.
    if (!path) return playNextSound();
    try {
      playingSound = true;
      const audio = new Audio(chrome.runtime.getURL(path));
      const done = () => {
        playingSound = false;
        playNextSound();
      };
      audio.addEventListener("ended", done, { once: true });
      audio.addEventListener("error", done, { once: true });
      // Rejects when Chrome's autoplay policy blocks it, which it will until
      // the user has interacted with the page at least once. Nothing to do but
      // move on; the message is still announced.
      audio.play().catch(done);
    } catch (e) {
      playingSound = false;
    }
  }

  function requestSound(key) {
    if (!key || soundQueue.length >= MAX_QUEUE) return;
    soundQueue.push(key);
    playNextSound();
  }

  /** Same test as the beep shim: Roll20's markup, never an "XdY" text match. */
  function isRoll(msg) {
    return (
      msg.classList.contains("rollresult") ||
      !!msg.querySelector("rolltemplate, .inlinerollresult")
    );
  }

  /** "crit" | "fail" | "" — the d20's own face, not the total. */
  function critFor(msg) {
    const template = msg.querySelector("rolltemplate");
    if (template) return critKindFromTemplate(template);

    // A `/roll`: the formula names the die, and `.didroll` is what it landed
    // on. `.backing` is skipped here for the same reason it is skipped when
    // reading the line — it is a dice-font glyph, not a number.
    const formula = textOf(msg, ".formula");
    if (!formula) return "";
    const dice = Array.prototype.map
      .call(msg.querySelectorAll(".didroll"), (die) => normalize(die.textContent))
      .filter(Boolean);
    return judge(formula, dice);
  }

  function soundFor(msg) {
    // A crit or a fumble is worth hearing whoever rolled it, so it is checked
    // before the "your own rolls are silent" rule.
    const crit = critFor(msg);
    if (crit) return crit;
    if (!isRoll(msg)) return "";
    return msg.classList.contains("you") ? "" : "other";
  }

  // --- Rolling from the chat box ----------------------------------------
  //
  // `roll.mp3` on a `/roll` or `/r` typed into the chat box, and on the same
  // thing sent with alt+shift+C, and on a `%{name|attribute}` macro shorthand
  // (what the roll shortcuts send). It fires on the **press**, not on the
  // message coming back, so it is confirmation that the roll went — the same
  // reasoning
  // as the sheet's own roll sound in features/last-result.js, and the reason
  // this cannot be driven from the chat log like every other sound here.
  //
  // Both routes are caught by watching the two ways Roll20 sends: Enter in the
  // textarea, and the send button. alt+shift+C needs no case of its own — it
  // sends by clicking that button, so the click listener already sees it.
  //
  // Read in the **capture** phase, because Roll20 clears the textarea as part
  // of handling the send and the value is gone by the time a bubbling listener
  // would run.

  // `/roll` or `/r` and nothing else. `\b`-style boundary so `/remove` and
  // `/rolltable` are not mistaken for rolls.
  const ROLL_COMMAND = /^\s*\/(roll|r)(\s|$)/i;

  // A Roll20 macro/ability/skill shorthand at the start of the message, e.g.
  // `%{Brother Lorian|deception}`. This is what the roll shortcuts send, so the
  // same press-confirmation sound covers them.
  const MACRO_ROLL = /^\s*%\{[^|{}]+\|[^}]+\}/;

  // Enter and a click on Send can both fire for one send. Two sounds for one
  // roll is worse than none.
  const RESEND_MS = 500;
  let lastRollSoundAt = 0;

  function noteSent(text) {
    const s = String(text || "");
    if (!ROLL_COMMAND.test(s) && !MACRO_ROLL.test(s)) return;
    const now = Date.now();
    if (now - lastRollSoundAt < RESEND_MS) return;
    lastRollSoundAt = now;
    requestSound("roll");
    debug("vttchat", "roll command sent from the chat box");
  }

  document.addEventListener(
    "keydown",
    (event) => {
      // Shift+Enter is a newline in Roll20's chat box, not a send.
      if (event.key !== "Enter") return;
      if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (!target || !target.matches || !target.matches(SEL_INPUT)) return;
      noteSent(target.value);
    },
    true
  );

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!target || !target.closest || !target.closest(SEL_SEND)) return;
      const input = document.querySelector(SEL_INPUT);
      if (input) noteSent(input.value);
    },
    true
  );

  // --- New messages -----------------------------------------------------

  let speaking = false;
  const pending = [];
  let flushTimer = null;

  // Message ids already spoken.
  //
  // Opening a character sheet from the Journal leaves the VTT handling the next
  // incoming chat message *twice*: Roll20's own new-message sound rings twice
  // and the node is added twice, though only one survives in the log. That
  // second handler is Roll20's, not ours — nothing here can play its sound —
  // so this cannot be fixed at the source, only refused at ours.
  //
  // Keyed on `data-messageid` rather than on the element, because the two
  // additions are two different nodes and `markOnce` therefore lets both
  // through.
  const spoken = new Set();
  // Ids are ~25 characters and a long session produces thousands. Dropping the
  // whole set is fine: the worst case is one duplicate getting through right
  // after a clear, and the ids that matter are always the most recent ones.
  const SPOKEN_LIMIT = 500;

  function flush() {
    flushTimer = null;
    const items = pending.splice(0, pending.length);
    if (!items.length) return;
    // A burst this size is history arriving, not people talking. Reading it
    // aloud would take minutes with no way to stop part-way. The backstop for
    // the rare genuine flurry is alt+shift+], which reads the end of the log on
    // demand.
    if (items.length > BULK_LIMIT) {
      debug("vttchat", "skipped a bulk arrival of " + items.length + " messages");
      return;
    }
    // The "others readout" toggle silences messages that are not mine — speech
    // and sounds both — while your own messages and rolls still go through.
    // Sounds are played here rather than as each message is processed so that
    // this guard covers them too. Playing a fanfare for a burst we then decline
    // to read was the shape of the original bug.
    const notifications = window.Roll20A11y.notifications;
    const audible = items.filter(
      (item) => item.mine || !notifications || notifications.isOthersReadoutOn()
    );
    if (!audible.length) return;
    for (const item of audible) requestSound(item.sound);
    announce(audible.map((item) => item.line).join(" "));
  }

  function process(msg, speak) {
    if (!msg.isConnected) return;
    const line = describeMessage(msg);
    if (!line) {
      // Nothing was recognised — a `news` banner, say, which is markup with no
      // text in it. Collapsing would hide it and put nothing in its place,
      // which is the one outcome worse than reading it raw. Leave it alone.
      debug("vttchat", "no line for a " + msg.className + " message, left as-is");
      return;
    }
    collapse(msg, line);
    debug("vttchat", "collapsed: " + line.slice(0, 80));

    const id = msg.getAttribute("data-messageid");
    if (!speak || !id) return;
    if (spoken.has(id)) {
      debug("vttchat", "already said " + id + ", not saying it again");
      return;
    }
    if (spoken.size > SPOKEN_LIMIT) spoken.clear();
    spoken.add(id);

    // The sound travels with the line and is played by `flush`, so both are
    // subject to the same bulk guard. Being inside the dedupe means Roll20
    // handling a sheet roll twice cannot play the fanfare twice either.
    //
    // The cursor sits past the end by default, and stays there — a new message
    // does not disturb someone who has walked back into the history.
    pending.push({ line: line, sound: soundFor(msg), mine: msg.classList.contains("you") });
    if (flushTimer === null) flushTimer = window.setTimeout(flush, SETTLE_MS);
  }

  let primeTimer = null;

  function openGate(why) {
    if (speaking) return;
    speaking = true;
    if (primeTimer !== null) {
      window.clearTimeout(primeTimer);
      primeTimer = null;
    }
    debug("vttchat", "now announcing new messages (" + why + ")");
    markReady("chat");
  }

  /** Another message while priming: the backlog is still coming. Wait longer. */
  function deferGate() {
    if (speaking) return;
    if (primeTimer !== null) window.clearTimeout(primeTimer);
    primeTimer = window.setTimeout(() => openGate("log went quiet"), PRIME_QUIET_MS);
  }

  enhance(SEL_MESSAGE, (msg) => {
    if (!markOnce(msg, "chat")) return;
    deferGate();
    // Cheap insurance, on the same tick the message lands and before the
    // browser has computed the accessibility update: if Roll20 has managed to
    // put its own `aria-live` back since the last sweep, this catches it before
    // it can read the raw version underneath ours.
    repair();
    // Whether to speak is decided now, not when the timer fires: the whole
    // backlog is enqueued in one synchronous pass before `speaking` is ever
    // true, and reading it at flush time would announce all of it.
    const speak = speaking;
    window.setTimeout(() => process(msg, speak), SETTLE_MS);
  });

  // Start the clock even if the log never produces a message — an empty
  // campaign must still end up live.
  deferGate();
  window.setTimeout(() => openGate("hit the ceiling"), PRIME_MAX_MS);

  // Roll20's own live region on the log is switched off, because it announces
  // the raw subtree — the pile this feature exists to replace. Ours speaks
  // instead, and only once the line has been built. Done in a sweep rather than
  // once, because the log is rebuilt when the campaign reconnects.
  function repair() {
    const log = document.querySelector(SEL_LOG);
    if (log && log.getAttribute("aria-live") !== "off") {
      log.setAttribute("aria-live", "off");
      debug("vttchat", "silenced Roll20's own live region on the chat log");
    }
  }

  function sweep() {
    repair();
    window.setTimeout(sweep, SWEEP_MS);
  }

  // --- The reading cursor -----------------------------------------------
  //
  // Held as the message *element*, never an index: Roll20 prunes the top of the
  // log as it grows, and an index silently comes to mean a different message.
  // `null` means "past the last message", which is where reading starts.

  let cursor = null;

  function messages() {
    return Array.prototype.slice.call(document.querySelectorAll(SEL_CHAT));
  }

  /**
   * Speak in this frame, sounding the edge tone first when there is one.
   *
   * Every `say` passed to `move` takes the same `(text, edge)` pair, so the two
   * frames stay interchangeable: this one speaks directly, and the one used for
   * a forwarded key posts both halves down to the sheet to do the same there.
   */
  function speakHere(text, edge) {
    if (edge) beep(edge);
    // "" means there is deliberately nothing to report — see `sendText`.
    if (text) announce(text);
  }

  function speakMessage(msg, say) {
    const lines = readLines(msg);
    // A message can be asked for before its settle timer has run, in which case
    // it has no line yet. Its raw text is what Roll20 would have said anyway.
    say(lines.length ? lines.join(" ") : normalize(msg.textContent) || "Empty message.");
  }

  function move(kind, say) {
    const all = messages();
    if (!all.length) {
      say("Chat is empty.");
      return;
    }

    const last = all.length - 1;
    // A pruned or replaced cursor resolves to -1, which the branches below read
    // as "past the end" — the same as never having moved.
    const at = cursor ? all.indexOf(cursor) : -1;

    if (kind === "first") {
      cursor = all[0];
    } else if (kind === "last") {
      cursor = all[last];
    } else if (kind === "reread") {
      cursor = at < 0 ? all[last] : all[at];
    } else if (kind === "prev") {
      if (at < 0) {
        cursor = all[last];
      } else if (at === 0) {
        say("Start of chat.", "start");
        return;
      } else {
        cursor = all[at - 1];
      }
    } else if (kind === "next") {
      if (at < 0 || at === last) {
        say("End of chat.", "end");
        return;
      }
      cursor = all[at + 1];
    } else {
      return;
    }

    speakMessage(cursor, say);
  }

  // --- Sending ----------------------------------------------------------

  /**
   * Roll20's chat box is a plain textarea, but its value is watched, so setting
   * `.value` directly is not always seen. The native setter plus a synthetic
   * `input` is the same technique `features/combobox-labels.js` uses to drive
   * the sheet's fields.
   */
  function setValue(input, value) {
    const descriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input),
      "value"
    );
    if (descriptor && descriptor.set) descriptor.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /**
   * Ask for a line and send it, leaving focus where it was.
   *
   * `window.prompt` is raised here even when the key was pressed in the sheet
   * frame, because Chrome blocks it inside a cross-origin iframe.
   *
   * Roll20 focuses the chat box as part of sending, so focus is captured and
   * put back — now, on the next tick, and once more at 60 ms, because the move
   * may happen synchronously inside the click or on a later tick. The same
   * dance as `clickWithoutStealingFocus` in features/roll-mode-keys.js.
   *
   * Whatever `#speakingas` is set to is used as it stands; this never changes
   * who you are speaking as.
   */
  function restorer(before) {
    return () => {
      const now = document.activeElement;
      if (now === before) return;
      if (before && before.isConnected && before !== document.body && before.focus) {
        before.focus();
      } else if (now && now.blur) {
        now.blur();
      }
    };
  }

  /**
   * Put `text` in the chat box and send it, leaving focus on `before`.
   *
   * `success` is what to say when it worked, and may be "" for the callers that
   * have better feedback already — a die shortcut is confirmed by its own roll
   * sound and then by the result arriving, so "Sent." would be a third
   * notification for one keypress. A failure is always spoken.
   *
   * `say` is still called with "" in the quiet case, because the sheet frame
   * uses that reply as its cue to take focus back.
   */
  function sendText(text, say, before, success) {
    const input = document.querySelector(SEL_INPUT);
    const button = document.querySelector(SEL_SEND);
    if (!input || !button) {
      say("Could not send: the chat box is missing.");
      debug("vttchat", "no chat input or send button");
      return;
    }

    const restore = restorer(before);

    setValue(input, text);
    button.click();
    restore();
    window.setTimeout(restore, 0);
    window.setTimeout(restore, 60);

    // Read the result back rather than asserting it: Roll20 clears the box on a
    // successful send, so a box that still has the text in it did not send.
    window.setTimeout(() => {
      if (normalize(input.value)) {
        say("Could not send.");
        debug("vttchat", "chat box still holds the text after sending");
        return;
      }
      say(success || "");
    }, 250);
  }

  /** alt+1 … alt+7. The roll sound comes free: `sendText` clicks the send
   *  button, and the capture-phase listener that watches for `/r` sees it. */
  function sendRoll(die, say, before) {
    sendText("/r " + die, say, before, "");
    debug("vttchat", "rolled " + die + " from a shortcut");
  }

  function promptAndSend(say) {
    const before = document.activeElement;
    let text = null;
    try {
      text = window.prompt("Send to chat:", "");
    } catch (e) {
      say("Could not open the message box.");
      return;
    }

    // Cancelled, or nothing typed. Nothing to report — the prompt itself was
    // the feedback — but the sheet frame still needs its cue to take focus
    // back, so the reply goes out empty rather than not at all.
    if (text === null || !normalize(text)) {
      restorer(before)();
      say("");
      return;
    }

    sendText(text, say, before, "Sent.");
  }

  /**
   * Parse a dice formula into the string to roll, or null when it is not one.
   *
   * A formula is one or more terms joined by `+` or `-`, where a term is
   * `XdY`, `dY` (shorthand for `1dY`), or a bare number `X`. Both `d` and `D`
   * are accepted. A bare `dY`/`DY` is normalised to `1dY` before it is sent.
   */
  function parseFormula(raw) {
    const s = String(raw || "").replace(/\s+/g, "");
    if (!s) return null;
    const term = "(?:[0-9]+[dD][0-9]+|[dD][0-9]+|[0-9]+)";
    if (!new RegExp("^" + term + "(?:[+-]" + term + ")*$").test(s)) return null;
    return s.replace(/(^|[+-])([dD])(?=[0-9])/g, (m, sign, d) => sign + "1" + d.toLowerCase());
  }

  /**
   * Ask for a dice formula and roll it with `/r`, leaving focus where it was.
   *
   * Same shape as `promptAndSend` — the prompt is raised here even when the key
   * was pressed in the sheet frame, and focus is restored the same way. A valid
   * formula is rolled silently (the press sound and the arriving result carry
   * the feedback); an invalid one is spoken rather than sent.
   */
  function promptRoll(say) {
    const before = document.activeElement;
    let text = null;
    try {
      text = window.prompt("Roll:", "");
    } catch (e) {
      say("Could not open the roll box.");
      return;
    }

    if (text === null) {
      restorer(before)();
      say("");
      return;
    }

    const formula = parseFormula(text);
    if (!formula) {
      restorer(before)();
      say("Invalid roll formula.");
      return;
    }

    sendRoll(formula, say, before);
  }

  // --- Keys and messages ------------------------------------------------

  document.addEventListener(
    "keydown",
    (event) => {
      const kind = chatKey(event);
      if (!kind) return;
      event.preventDefault();
      const die = dieOf(kind);
      if (die) sendRoll(die, speakHere, document.activeElement);
      else if (kind === "send") promptAndSend(speakHere);
      else if (kind === "rollprompt") promptRoll(speakHere);
      else move(kind, speakHere);
    },
    true
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (!isReadKey(event)) return;
      event.preventDefault();
      move("reread", speakHere);
    },
    true
  );

  // Forwarded from the sheet frame. Focus never leaves it, so the outcome goes
  // back for that frame to speak rather than being announced here.
  window.addEventListener("message", (event) => {
    if (event.origin !== SHEET_ORIGIN) return;
    const data = event.data || {};
    const source = event.source;
    const reply = (text, edge) => {
      try {
        source.postMessage(
          { r20a11yChatResult: text, r20a11yChatEdge: edge || "" },
          SHEET_ORIGIN
        );
      } catch (e) {
        /* frame unreachable; the action still happened */
      }
    };

    // Only the formulas this extension offers are ever sent, looked up rather
    // than taken from the message, so a post cannot put arbitrary text into the
    // user's chat box.
    if (typeof data.r20a11yChatRoll === "string") {
      const die = data.r20a11yChatRoll;
      let known = false;
      for (const code in DICE) if (DICE[code] === die) known = true;
      if (known) sendRoll(die, reply, document.activeElement);
      return;
    }
    if (data.r20a11yChatPrompt) {
      promptAndSend(reply);
      return;
    }
    if (data.r20a11yChatRollPrompt) {
      promptRoll(reply);
      return;
    }
    if (typeof data.r20a11yChatNav === "string" && NAV_KINDS.indexOf(data.r20a11yChatNav) >= 0) {
      move(data.r20a11yChatNav, reply);
      return;
    }
    // last-result.js's sheet half forwards alt+O under this name. On the
    // character-sheet page its own top half answers; here, this does.
    if (data.r20a11yReannounce) move("reread", reply);
  });

  // Shared with features/roll-shortcuts.js: send arbitrary text to the chat box
  // and leave focus on `before`. `success` may be "" for a silent send (the
  // result arrives in the log and is announced there). Only defined here, in
  // the VTT top frame, which is the only place a chat send can happen.
  window.Roll20A11y.sendChatText = (text, before, success) => {
    sendText(text, speakHere, before, success || "");
  };

  sweep();
})();
