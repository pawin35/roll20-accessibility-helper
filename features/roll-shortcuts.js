/**
 * Feature: roll shortcuts for the VTT — skill, ability, and initiative.
 *
 *   alt+shift+S   open the skill-roll dropdown   (acrobatics, … survival)
 *   alt+shift+A   open the ability-roll dropdown (checks and saves)
 *   alt+shift+I   roll initiative directly
 *   alt+shift+D   roll a death save directly
 *   alt+shift+H   whisper a readout of the character's HP and AC
 *
 * A character's skill/ability is rolled by sending Roll20's macro form
 * `%{Character Name|attribute}` into the chat box. The character name is the
 * current player's first controlled character, by name, read from the VTT's
 * "Speak As" dropdown (`#speakingas`) — the options Roll20 already keeps
 * sorted, so the first `character|…` option is the one to roll as.
 *
 * Skill and ability both open a native `<dialog>` (showModal) holding a single
 * `<select>`. The platform supplies what "aria modal" asks for — role="dialog",
 * aria-modal, a focus trap over the rest of the page, and focus restore to the
 * previously-focused element on close — so no manual trap is needed. The
 * dropdown is focused on open; Escape or the Close button dismisses without
 * rolling, and choosing an option rolls it and dismisses. The initiative,
 * death-save, and state shortcuts have no dropdown and send straight away.
 *
 * The send itself goes through `Roll20A11y.sendChatText` (exported by
 * features/vtt-chat.js), so it reuses the same focus-restore dance as every
 * other chat send, and the result is announced when it arrives in the log —
 * no "Sent." in between.
 *
 * Like the other shortcuts this is registered in both frames: while focus is
 * in the floating character sheet the key is forwarded up, the top frame acts,
 * and focus is handed back down once the dialog closes (or the roll is sent).
 */
(function () {
  "use strict";

  const { CLASS_PREFIX, announce, debug } = window.Roll20A11y;

  const TOP_ORIGIN = "https://app.roll20.net";
  const SHEET_ORIGIN = "https://advanced-sheets.production.roll20preflight.net";

  /** "skill" | "ability" | "initiative" | "deathsave" | "state" | "". Matched on `event.code`. */
  function rollKey(event) {
    if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return "";
    const code = event.code || "";
    if (code === "KeyS") return "skill";
    if (code === "KeyA") return "ability";
    if (code === "KeyI") return "initiative";
    if (code === "KeyD") return "deathsave";
    if (code === "KeyH") return "state";
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
      if (event.data && event.data.r20a11yRollShortcutDone) restore();
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

  // --- The current character --------------------------------------------

  /**
   * The first character the current player controls, by name, or "".
   *
   * Read from `#speakingas`, the VTT's "Speak As" select: Roll20 lists the
   * player plus every character they can control, so the first option whose
   * value starts "character|" is the player's own character. Sorting the names
   * again makes "first" mean "first alphabetically" regardless of the order
   * Roll20 chose.
   */
  function currentCharacterName() {
    const sel = document.querySelector("#speakingas");
    if (!sel || !sel.options) return "";
    const names = [];
    for (const opt of sel.options) {
      if (String(opt.value || "").indexOf("character|") === 0) {
        const name = (opt.text || "").trim();
        if (name) names.push(name);
      }
    }
    if (!names.length) return "";
    names.sort((a, b) => a.localeCompare(b));
    return names[0];
  }

  function sendChat(text, before, success) {
    const send = window.Roll20A11y.sendChatText;
    if (typeof send === "function") {
      send(text, before, success || "");
    } else {
      announce("Could not send: the chat helper is missing.");
      debug("rollshortcuts", "sendChatText not available");
    }
  }

  // --- The modal --------------------------------------------------------
  //
  // A native <dialog>.showModal() is what "aria modal" asks for: the platform
  // exposes it with role="dialog" and aria-modal, makes the rest of the page
  // inert (which is the focus trap), fires `cancel` on Escape, and returns
  // focus to whatever had it before the dialog opened.
  //
  // The control inside is an ARIA listbox, not a <select>. A native select
  // cannot give the wanted reading: in Chrome a collapsed one commits the new
  // value on the very first Down arrow, and the `showPicker()` workaround opens
  // a popup a screen reader cannot read. A listbox announces every option as
  // focus moves through it, and commits only on Enter, Space, or a click.

  let dialog = null;
  let titleEl = null;
  let labelEl = null;
  let listbox = null;
  let options = [];
  let activeIndex = 0;
  let activeName = "";
  let lastFocus = null;
  let pendingSheet = null;

  function ensureModal() {
    if (dialog) return;
    dialog = document.createElement("dialog");
    dialog.className = CLASS_PREFIX + "-modal";

    titleEl = document.createElement("h2");
    titleEl.id = CLASS_PREFIX + "-roll-title";
    dialog.setAttribute("aria-labelledby", titleEl.id);
    dialog.appendChild(titleEl);

    labelEl = document.createElement("span");
    labelEl.id = CLASS_PREFIX + "-roll-label";

    listbox = document.createElement("div");
    listbox.setAttribute("role", "listbox");
    listbox.setAttribute("aria-labelledby", labelEl.id);

    dialog.appendChild(labelEl);
    dialog.appendChild(listbox);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = CLASS_PREFIX + "-btn";
    closeBtn.textContent = "Close";
    dialog.appendChild(closeBtn);

    document.body.appendChild(dialog);

    // Escape on a modal dialog fires `cancel`; the default would close the
    // dialog without our cleanup, so it is stopped and closed here instead.
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeModal(false, "");
    });

    listbox.addEventListener("keydown", (event) => {
      const key = event.key;
      if (key === "ArrowDown") {
        event.preventDefault();
        setActive(activeIndex + 1);
      } else if (key === "ArrowUp") {
        event.preventDefault();
        setActive(activeIndex - 1);
      } else if (key === "Home") {
        event.preventDefault();
        setActive(0);
      } else if (key === "End") {
        event.preventDefault();
        setActive(options.length - 1);
      } else if (key === "Enter" || key === " ") {
        event.preventDefault();
        commit();
      }
    });

    listbox.addEventListener("click", (event) => {
      const opt =
        event.target && event.target.closest
          ? event.target.closest('[role="option"]')
          : null;
      if (!opt) return;
      const i = options.indexOf(opt);
      if (i >= 0) setActive(i);
      commit();
    });

    closeBtn.addEventListener("click", () => closeModal(false, ""));
  }

  /**
   * Move the active option to `i`, keeping a roving tabindex: exactly one
   * option is a tab stop at a time. Focusing the option is what reads it.
   */
  function setActive(i) {
    if (!options.length || i < 0 || i >= options.length) return;
    if (activeIndex >= 0 && activeIndex < options.length && options[activeIndex]) {
      options[activeIndex].setAttribute("tabindex", "-1");
      options[activeIndex].setAttribute("aria-selected", "false");
    }
    activeIndex = i;
    options[i].setAttribute("tabindex", "0");
    options[i].setAttribute("aria-selected", "true");
    options[i].focus();
  }

  /** Roll the active option and close the modal. */
  function commit() {
    if (activeIndex < 0 || activeIndex >= options.length) return;
    closeModal(true, options[activeIndex].dataset.value);
  }

  /** Open the modal for a roll kind. Returns false when it cannot open. */
  function openModal(kind) {
    ensureModal();
    if (dialog.open) return false;
    activeName = currentCharacterName();
    if (!activeName) {
      announce("You have no character to roll as.");
      return false;
    }

    const items = kind === "skill" ? SKILLS : ABILITIES;
    titleEl.textContent = kind === "skill" ? "Skill roll" : "Ability roll";
    labelEl.textContent = kind === "skill" ? "Choose a skill" : "Choose an ability";
    listbox.textContent = "";
    options = [];
    items.forEach(([display, attr], i) => {
      const opt = document.createElement("div");
      opt.setAttribute("role", "option");
      // The first option is the tab stop so showModal autofocuses the listbox
      // rather than the Close button; setActive moves the roving tabindex.
      opt.setAttribute("tabindex", i === 0 ? "0" : "-1");
      opt.setAttribute("aria-selected", i === 0 ? "true" : "false");
      opt.textContent = display;
      opt.dataset.value = attr;
      listbox.appendChild(opt);
      options.push(opt);
    });
    activeIndex = 0;

    lastFocus = document.activeElement;
    dialog.showModal();
    options[0].focus();
    return true;
  }

  function closeModal(doSend, value) {
    if (!dialog || !dialog.open) return;
    dialog.close();
    if (doSend && value && activeName) {
      sendChat("%{" + activeName + "|" + value + "}", lastFocus, "");
    }
    // Don't rely on the dialog's own focus restoration — put focus back on the
    // element that had it before the modal opened. For a forwarded key that
    // element is the sheet <iframe>; `replyDone` then lets the sheet frame
    // restore the control inside it.
    if (
      lastFocus &&
      lastFocus.isConnected &&
      lastFocus.focus &&
      document.activeElement !== lastFocus
    ) {
      lastFocus.focus();
    }
    replyDone();
  }

  // --- Initiative -------------------------------------------------------

  function sendInitiative() {
    const name = currentCharacterName();
    if (!name) {
      announce("You have no character to roll as.");
      return;
    }
    sendChat("%{" + name + "|initiative}", document.activeElement, "");
  }

  // --- Death save & state ----------------------------------------------

  function sendDeathSave() {
    const name = currentCharacterName();
    if (!name) {
      announce("You have no character to roll as.");
      return;
    }
    sendChat("%{" + name + "|death_save}", document.activeElement, "");
  }

  function sendState() {
    const name = currentCharacterName();
    if (!name) {
      announce("You have no character to roll as.");
      return;
    }
    const text =
      '/w "' + name + '" HP @{' + name + "|hp} out of @{" + name +
      "|hp|max}, with @{" + name + "|hp_temp} temp HP, AC is at @{" +
      name + "|ac}";
    sendChat(text, document.activeElement, "");
  }

  // --- Routing ----------------------------------------------------------

  // Tell the sheet frame (when the shortcut came from it) that the action has
  // finished and it can take focus back.
  function replyDone() {
    if (!pendingSheet) return;
    try {
      pendingSheet.postMessage({ r20a11yRollShortcutDone: true }, SHEET_ORIGIN);
    } catch (e) {
      /* frame unreachable; the roll still went */
    }
    pendingSheet = null;
  }

  function doShortcut(kind) {
    if (kind === "initiative") {
      sendInitiative();
      replyDone();
      return;
    }
    if (kind === "deathsave") {
      sendDeathSave();
      replyDone();
      return;
    }
    if (kind === "state") {
      sendState();
      replyDone();
      return;
    }
    if (!openModal(kind)) replyDone();
  }

  document.addEventListener(
    "keydown",
    (event) => {
      const kind = rollKey(event);
      if (!kind) return;
      event.preventDefault();
      doShortcut(kind);
    },
    true
  );

  // Escape closes the modal in one press, wherever focus sits inside it. At the
  // document (capture) level so it also fires ahead of the listbox's own
  // keydown handler and any focus-mode key handling the screen reader does
  // before handing the key to the page. The dialog's native `cancel` event
  // remains as a fallback for browsers that close on Escape themselves.
  document.addEventListener(
    "keydown",
    (event) => {
      if (!dialog || !dialog.open) return;
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeModal(false, "");
    },
    true
  );

  window.addEventListener("message", (event) => {
    if (event.origin !== SHEET_ORIGIN) return;
    const kind = event.data && event.data.r20a11yRollShortcut;
    if (!["skill", "ability", "initiative", "deathsave", "state"].includes(kind)) return;
    pendingSheet = event.source;
    doShortcut(kind);
  });
})();
