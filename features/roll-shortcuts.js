/**
 * Feature: roll shortcuts for the VTT — skill, ability, and initiative.
 *
 *   alt+shift+S   open the skill-roll dropdown   (acrobatics, … survival)
 *   alt+shift+A   open the ability-roll dropdown (checks and saves)
 *   alt+shift+I   roll initiative directly
 *   alt+shift+D   roll a death save directly
 *   alt+shift+H   speak the character's HP and AC
 *   alt+shift+T   speak the character's remaining spell slots
 *
 * A character's skill/ability is rolled by sending Roll20's macro form
 * `%{Character Name|attribute}` into the chat box. The character name is the
 * current player's first controlled character, by name, read from the VTT's
 * "Speak As" dropdown (`#speakingas`) — the options Roll20 already keeps
 * sorted, so the first `character|…` option is the one to roll as.
 *
 * Skill and ability both open the shared modal from `lib/choice-modal.js` — a
 * native `<dialog>` holding an ARIA listbox. It is focused on open; Escape or
 * the Close button dismisses without rolling, and choosing an option rolls it
 * and dismisses. The initiative, death-save, and state shortcuts have no
 * dropdown and send straight away.
 *
 * H and T send nothing: they read the character model through
 * `Roll20A11y.requestCharacter` and speak the answer. H used to whisper itself
 * the numbers in chat, which needed the sheet worker running to resolve
 * `@{Name|hp}`, put a line in the log every time it was pressed, and told
 * everyone at the table that it had been. The model route has none of those
 * costs and works with the sheet shut.
 *
 * The rolling shortcuts still send: that goes through
 * `Roll20A11y.sendChatText` (exported by
 * features/vtt-chat.js), so it reuses the same focus-restore dance as every
 * other chat send, and the result is announced when it arrives in the log —
 * no "Sent." in between.
 *
 * Registered in both frames. While focus is in the floating character sheet the
 * key is forwarded up and the top frame acts. For the two dropdowns the dialog
 * is then opened back down *in the sheet frame* by `lib/remote-modal.js`, so
 * focus never crosses the iframe boundary; for everything else the reply is the
 * sheet's cue to take focus back, and carries anything to speak.
 */
(function () {
  "use strict";

  const {
    announce,
    debug,
    choiceModal,
    currentCharacterName,
    characterRolls,
    requestCharacter,
    remoteModal,
    claimNextAnnouncement,
  } = window.Roll20A11y;

  const TOP_ORIGIN = "https://app.roll20.net";
  const SHEET_ORIGIN = "https://advanced-sheets.production.roll20preflight.net";

  /**
   * "skill" | "ability" | "initiative" | "deathsave" | "state" | "slots" | "".
   * Matched on `event.code` so a non-US layout still works.
   */
  function rollKey(event) {
    if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return "";
    const code = event.code || "";
    if (code === "KeyS") return "skill";
    if (code === "KeyA") return "ability";
    if (code === "KeyI") return "initiative";
    if (code === "KeyD") return "deathsave";
    if (code === "KeyH") return "state";
    if (code === "KeyT") return "slots";
    return "";
  }

  // --- Sheet frame ------------------------------------------------------
  //
  // The floating sheet is a cross-origin iframe: the key never reaches the VTT
  // document while focus is in it, so it is forwarded. The modal lives up
  // there, so focus leaves this frame while it is open; the "done" reply is
  // this frame's cue to put focus back on the control that had it.

  if (window.top !== window) {
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
        const kind = rollKey(event);
        if (!kind) return;
        event.preventDefault();
        if (choiceModal.isOpen()) return;
        returnTo = document.activeElement;
        try {
          window.parent.postMessage({ r20a11yRollShortcut: kind }, TOP_ORIGIN);
        } catch (e) {
          /* parent unreachable; nothing else this frame can do */
        }
      },
      true
    );

    window.addEventListener("message", (event) => {
      if (event.origin !== TOP_ORIGIN) return;
      const done = event.data && event.data.r20a11yRollShortcutDone;
      if (!done) return;
      restore();
      // A readout is spoken here, in the frame the user is actually in, the
      // same way the chat shortcuts hand their result back down.
      const say = event.data.r20a11ySay;
      if (say) announce(say);
    });

    return;
  }

  // --- The dropdown contents --------------------------------------------

  // Display label → the attribute the macro rolls. Strings taken verbatim from
  // the user's spec; only `character_name` is substituted at send time.
  const SKILLS = [
    ["Acrobatics", "acrobatics"],
    ["Animal Handling", "animal_handling"],
    ["Arcana", "arcana"],
    ["Athletics", "athletics"],
    ["Deception", "deception"],
    ["History", "history"],
    ["Insight", "insight"],
    ["Intimidation", "intimidation"],
    ["Investigation", "investigation"],
    ["Medicine", "medicine"],
    ["Nature", "nature"],
    ["Perception", "perception"],
    ["Performance", "performance"],
    ["Persuasion", "persuasion"],
    ["Religion", "religion"],
    ["Sleight of Hand", "sleight_of_hand"],
    ["Stealth", "stealth"],
    ["Survival", "survival"],
  ];

  const ABILITIES = [
    ["Strength Check", "strength"],
    ["Dexterity Check", "dexterity"],
    ["Constitution Check", "constitution"],
    ["Intelligence Check", "intelligence"],
    ["Wisdom Check", "wisdom"],
    ["Charisma Check", "charisma"],
    ["Strength Save", "strength_save"],
    ["Dexterity Save", "dexterity_save"],
    ["Constitution Save", "constitution_save"],
    ["Intelligence Save", "intelligence_save"],
    ["Wisdom Save", "wisdom_save"],
    ["Charisma Save", "charisma_save"],
  ];

  function sendChat(text, before, success) {
    const send = window.Roll20A11y.sendChatText;
    if (typeof send === "function") {
      send(text, before, success || "");
    } else {
      announce("Could not send: the chat helper is missing.");
      debug("rollshortcuts", "sendChatText not available");
    }
  }

  // --- The dropdowns ----------------------------------------------------

  /**
   * Build the list and open it. `frame` is the sheet frame that forwarded the
   * key, or null when it was pressed here — `remoteModal` opens the dialog in
   * whichever of the two that is, and owns the focus hand-back from there.
   */
  function openModal(kind, frame) {
    if (choiceModal.isOpen()) return;

    // Read once, up front, so a roll cannot be sent as a different character
    // than the one the dialog was built for.
    const name = currentCharacterName();
    if (!name) return remoteModal.fail(frame, "You have no character to roll as.");

    remoteModal.open({
      frame,
      title: kind === "skill" ? "Skill roll" : "Ability roll",
      label: kind === "skill" ? "Choose a skill" : "Choose an ability",
      items: (kind === "skill" ? SKILLS : ABILITIES).map(([display, attr]) => ({
        display,
        value: attr,
      })),
      onCommit: (value) => {
        if (value) sendChat("%{" + name + "|" + value + "}", null, "");
      },
    });
  }

  // --- Direct sends (initiative, death save, state) --------------------

  // The character name is substituted as the bare token `NAME`. A `{name}`
  // placeholder does not work here: the templates use Roll20's own braces, and
  // `%{name|initiative}` / `@{name|hp}` close the brace *after* the attribute,
  // so a regex for a literal `{name}` never matches them.
  function sendDirect(text) {
    const name = currentCharacterName();
    if (!name) {
      announce("You have no character to roll as.");
      return;
    }
    sendChat(text.replace(/NAME/g, name), document.activeElement, "");
  }

  function sendInitiative() {
    sendDirect("%{NAME|initiative}");
  }

  function sendDeathSave() {
    sendDirect("%{NAME|death_save}");
  }

  // --- Readouts (HP and AC, spell slots) --------------------------------
  //
  // Both read the character model rather than asking Roll20 to tell us in chat.
  // Nothing is sent, so nothing lands in the log and the rest of the table
  // learns nothing.

  async function readCharacter() {
    const name = currentCharacterName();
    if (!name) return { error: "You have no character to roll as." };
    const data = await requestCharacter(name);
    if (!data || !data.integrants) {
      debug("rollshortcuts", "no model: " + ((data && data.error) || "timeout"));
      return { error: "Could not read your character." };
    }
    return { data };
  }

  async function speakState() {
    const { error, data } = await readCharacter();
    if (error) return error;
    const text = characterRolls.stateText(data.meta, data.hitpoints);
    return text || "Could not read your hit points or armour class.";
  }

  async function speakSlots() {
    const { error, data } = await readCharacter();
    if (error) return error;
    return characterRolls.spellSlotText(data.integrants, data.spellSlots);
  }

  // --- Routing ----------------------------------------------------------

  // The sheet frame awaiting a reply, or null when the key was pressed here.
  // Only the non-dialog kinds use this: a dropdown's focus is handled entirely
  // inside the frame it opened in, by lib/remote-modal.js.
  let pendingSheet = null;

  /**
   * Tell the sheet frame it may take focus back, carrying anything to speak so
   * it is announced where the user is. With no sheet frame waiting, `say` is
   * announced here instead.
   */
  function replyDone(say) {
    const frame = pendingSheet;
    pendingSheet = null;
    if (frame) {
      try {
        frame.postMessage(
          { r20a11yRollShortcutDone: true, r20a11ySay: say || "" },
          SHEET_ORIGIN
        );
        return;
      } catch (e) {
        /* frame unreachable; fall through and speak here instead */
      }
    }
    if (say) announce(say);
  }

  function doShortcut(kind, frame) {
    if (kind === "skill" || kind === "ability") {
      openModal(kind, frame);
      return;
    }

    pendingSheet = frame || null;

    if (kind === "state") {
      speakState().then(replyDone);
      return;
    }
    if (kind === "slots") {
      speakSlots().then(replyDone);
      return;
    }
    // A roll that goes straight to chat. Its result arrives in this frame's
    // log, so it is claimed for the frame the user is in before it is sent.
    claimNextAnnouncement(frame);
    if (kind === "initiative") sendInitiative();
    else sendDeathSave();
    replyDone();
  }

  document.addEventListener(
    "keydown",
    (event) => {
      const kind = rollKey(event);
      if (!kind) return;
      event.preventDefault();
      doShortcut(kind, null);
    },
    true
  );

  window.addEventListener("message", (event) => {
    if (event.origin !== SHEET_ORIGIN) return;
    const kind = event.data && event.data.r20a11yRollShortcut;
    if (!["skill", "ability", "initiative", "deathsave", "state", "slots"].includes(kind))
      return;
    doShortcut(kind, event.source);
  });
})();
