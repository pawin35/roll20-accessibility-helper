/**
 * Feature: attack roll shortcuts for the VTT.
 *
 *   alt+W         open the attack-roll dropdown
 *   alt+shift+W   open the attack-damage dropdown
 *
 * Both list the character's attacks in the order the sheet holds them, named
 * with what they will roll — "Longsword (One-Handed) - attack roll +5" for the
 * first, "Longsword (One-Handed) - damage 1d8+3" for the second — and send
 * Roll20's repeating-section macro for the chosen row:
 *
 *   %{Name|repeating_attack_$N_attack}       the attack roll
 *   %{Name|repeating_attack_$N_attack_dmg}   its damage
 *
 * `$N` is the row's position among the Attack integrants, and **nothing may be
 * filtered or reordered** on the way to the list or the wrong attack rolls.
 * Only those two action names work: `_damage`, `_dmg`, `_roll` and `_crit` are
 * all answered by Roll20 with "…is not a supported action".
 *
 * The rows come from the character model, not the DOM: `page/character-bridge.js`
 * reads `Campaign.characters` in the page world and posts the raw integrants
 * over, `lib/character-rolls.js` derives the labels. No sheet needs to be open —
 * the model is populated at game join.
 *
 * Registered in both frames. While focus is in the floating character sheet the
 * key is forwarded up, the top frame works out what is in the list, and
 * `lib/remote-modal.js` opens the dialog back down *in the sheet frame* — so
 * focus never crosses the iframe boundary and the roll result is routed down to
 * be spoken there. This file no longer manages focus at all.
 */
(function () {
  "use strict";

  const {
    announce,
    debug,
    choiceModal,
    characterRolls,
    currentCharacterName,
    requestCharacter,
    remoteModal,
  } = window.Roll20A11y;

  const TOP_ORIGIN = "https://app.roll20.net";
  const SHEET_ORIGIN = "https://advanced-sheets.production.roll20preflight.net";

  const KINDS = ["attack", "attackdmg"];

  /**
   * "attack" | "attackdmg" | "". Matched on `event.code` so a non-US layout
   * still works.
   *
   * The two are split by shift and nothing else, so each branch states its own
   * shift requirement outright. If either ever stops checking, one keypress
   * runs both handlers — the same trap the alt+<n> dice keys and the
   * alt+shift+<n> sidebar keys already have to avoid.
   */
  function attackKey(event) {
    if (!event.altKey || event.ctrlKey || event.metaKey) return "";
    if (event.code !== "KeyW") return "";
    return event.shiftKey ? "attackdmg" : "attack";
  }

  // --- Sheet frame ------------------------------------------------------
  //
  // The floating sheet is a cross-origin iframe: the key never reaches the VTT
  // document while focus is in it, so it is forwarded. Only the *list* is built
  // up there — the dialog itself comes back and opens here, and
  // `lib/remote-modal.js` handles it from that point on, including putting
  // focus back on the control this frame started from.

  if (window.top !== window) {
    document.addEventListener(
      "keydown",
      (event) => {
        const kind = attackKey(event);
        if (!kind) return;
        event.preventDefault();
        if (choiceModal.isOpen()) return;
        try {
          window.parent.postMessage({ r20a11yAttackShortcut: kind }, TOP_ORIGIN);
        } catch (e) {
          /* parent unreachable; nothing else this frame can do */
        }
      },
      true
    );
    return;
  }

  // --- The dropdown -----------------------------------------------------

  function sendChat(text) {
    const send = window.Roll20A11y.sendChatText;
    if (typeof send === "function") {
      // "" success message: the roll sound fires on the press and the result is
      // announced when it arrives in the log, so a "Sent." between them would
      // be three notifications for one key.
      send(text, null, "");
    } else {
      announce("Could not send: the chat helper is missing.");
      debug("attackshortcuts", "sendChatText not available");
    }
  }

  /** The macro action for each dropdown. Only these two names are supported. */
  function actionFor(kind) {
    return kind === "attackdmg" ? "attack_dmg" : "attack";
  }

  function displayFor(kind, row) {
    return kind === "attackdmg"
      ? characterRolls.damageText(row)
      : characterRolls.attackText(row);
  }

  /**
   * Build the list and open it. `frame` is the sheet frame that forwarded the
   * key, or null when it was pressed here — `remoteModal` opens the dialog in
   * whichever of the two that is.
   */
  async function openModal(kind, frame) {
    if (choiceModal.isOpen()) return;

    const name = currentCharacterName();
    if (!name) return remoteModal.fail(frame, "You have no character to roll as.");

    const data = await requestCharacter(name);
    if (!data || !data.integrants) {
      debug("attackshortcuts", "no model: " + ((data && data.error) || "timeout"));
      return remoteModal.fail(frame, "Could not read your character's attacks.");
    }

    const rows = characterRolls.attackRows(data.integrants);
    if (!rows.length) return remoteModal.fail(frame, "You have no attacks.");

    // The character the rows were built for, so a roll cannot be sent as
    // someone else if the Speak As dropdown changes while the modal is open.
    const rollAs = data.name || name;
    debug("attackshortcuts", kind + " rows: " + rows.length + " for " + rollAs);

    remoteModal.open({
      frame,
      title: kind === "attackdmg" ? "Attack damage" : "Attack roll",
      label: kind === "attackdmg" ? "Choose a damage roll" : "Choose an attack",
      items: rows.map((row) => ({
        display: displayFor(kind, row),
        value: String(row.index),
      })),
      onCommit: (value) => {
        sendChat(
          "%{" + rollAs + "|repeating_attack_$" + value + "_" + actionFor(kind) + "}"
        );
      },
    });
  }

  // --- Routing ----------------------------------------------------------

  // One request at a time. Two presses in quick succession would otherwise both
  // reach the page world and both try to open a dialog.
  let busy = false;

  function doShortcut(kind, frame) {
    if (busy || choiceModal.isOpen()) {
      remoteModal.fail(frame, "Still opening the previous list.");
      return;
    }
    busy = true;
    openModal(kind, frame).then(
      () => {
        busy = false;
      },
      () => {
        busy = false;
      }
    );
  }

  document.addEventListener(
    "keydown",
    (event) => {
      const kind = attackKey(event);
      if (!kind) return;
      event.preventDefault();
      doShortcut(kind, null);
    },
    true
  );

  window.addEventListener("message", (event) => {
    if (event.origin !== SHEET_ORIGIN) return;
    const kind = event.data && event.data.r20a11yAttackShortcut;
    if (KINDS.indexOf(kind) < 0) return;
    doShortcut(kind, event.source);
  });
})();
