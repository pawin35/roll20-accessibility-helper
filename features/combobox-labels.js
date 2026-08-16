/**
 * Feature: fix the combobox groups in PROFICIENCIES & LANGUAGES.
 *
 *   <div class="combobox">
 *     <label class="combobox-label">Armor</label>    no `for`, no id
 *     <div class="combobox--inner">
 *       <div class="combobox-chip">Light</div>       existing proficiencies
 *       <div class="combobox-chip">Medium</div>
 *       <input class="combobox__input" list="…">     adds another
 *   <datalist>…</datalist>
 *
 * Four problems:
 *
 * 1. The <label> is not associated with anything — no `for`, and no id on the
 *    field — so four comboboxes in a row are announced with no name.
 * 2. The chips are adjacent inline elements, so they run together:
 *    "MediumShieldsHeavy".
 * 3. The list of chips is not identified, so it is heard as a bare list with
 *    no indication of what it lists.
 * 4. The field is `<input list>` + `<datalist>`. The browser draws that popup
 *    itself, which is why arrow keys work while a screen reader stays silent —
 *    datalist options are not reliably announced, and no markup fixes that.
 *
 * --- Why this file sweeps instead of observing -----------------------------
 *
 * `enhance()` fires only for *added* nodes, and `.combobox` is added exactly
 * once — so everything here would run once and never again, while Vue re-renders
 * this panel whenever a chip is added. That re-render replaced the input
 * (dropping the `aria-hidden`, so the dead dropdown came back) and destroyed the
 * injected disclosure button (so an expanded list could no longer be collapsed).
 * One cause, both symptoms: nothing re-applied the work.
 *
 * Three attempts at a targeted fix all failed, and they failed for the same
 * reason — each one assumed it knew which node Vue would replace:
 *
 *   1. picker inside `.combobox`, no observer   destroyed, never rebuilt
 *   2. picker inside `.combobox`, observer on   observer saw its own writes and
 *      that same subtree                        span forever
 *   3. picker outside `.combobox`, observer on  observer could no longer see the
 *      `.combobox`                              picker being destroyed
 *
 * So: no prediction. A `setTimeout` sweep re-asserts every combobox twice a
 * second, and `repair()` is written so that a pass with nothing to do performs
 * no DOM writes at all. It costs four `querySelectorAll`s and cannot be
 * outsmarted by a render pattern we have not seen yet.
 */
(function () {
  "use strict";

  const { announce, debug, enhance, ensureId, CLASS_PREFIX } = window.Roll20A11y;

  const SEL_BOX = ".combobox";
  const SEL_LABEL = ".combobox-label";
  const SEL_INPUT = ".combobox__input";
  const SEL_CHIP = ".combobox-chip";
  const SEL_INNER = ".combobox--inner";

  // Roll20 captions these with a single word, which is fine when you can see
  // the panel heading above them and ambiguous when you cannot. Languages are
  // deliberately not called proficiencies — they are not one.
  const CATEGORIES = {
    Weapons: { heading: "Weapon proficiencies", add: "Add weapon proficiency" },
    Armor: { heading: "Armor proficiencies", add: "Add armor proficiency" },
    Tools: { heading: "Tool proficiencies", add: "Add tool proficiency" },
    Languages: { heading: "Languages", add: "Add language" },
  };

  // --- Chips --------------------------------------------------------------
  //
  // Roll20 renders the chips as adjacent inline elements, so they run together:
  // "MediumShieldsHeavy". They need to be a list, and every chip needs to be in
  // it — including ones Vue appends or moves later, which is why this is part
  // of the sweep rather than a one-shot pass. An early version grouped them
  // once and any chip added afterwards landed outside the wrapper and announced
  // as "out of list".

  /**
   * Ensures `.combobox--inner`'s chips form a list. Idempotent, and writes
   * nothing when the arrangement is already correct.
   *
   * `.combobox--inner` cannot itself take `role="list"` because it also holds
   * the text input, and an input is not a valid child of a list — that risked
   * dropping the field from the accessibility tree entirely. `display: contents`
   * keeps the chips as flex children of the original row, so nothing moves.
   */
  function repairChips(box) {
    const inner = box.querySelector(SEL_INNER);
    if (!inner) return;

    const chips = inner.querySelectorAll(SEL_CHIP);
    if (!chips.length) return;

    let list = inner.querySelector(':scope > [role="list"]');
    if (!list) {
      list = document.createElement("div");
      list.setAttribute("role", "list");
      list.style.display = "contents";

      // Deliberately unnamed: the category is announced by the heading directly
      // before it, and naming the list too meant hearing "Armor" twice.
      const input = inner.querySelector(SEL_INPUT);
      if (input) input.insertAdjacentElement("beforebegin", list);
      else inner.appendChild(list);
    }

    for (const chip of chips) {
      if (chip.getAttribute("role") !== "listitem") {
        chip.setAttribute("role", "listitem");
      }
      if (chip.parentElement !== list) list.appendChild(chip);
    }
  }

  // --- One combobox -------------------------------------------------------
  //
  // Keyed on the element itself rather than on `markOnce`, because a
  // `data-` attribute survives Vue MOVING an element — so a moved combobox
  // would be treated as already-handled while its picker had been left behind.
  // A WeakMap answers the question that actually matters: does this exact
  // element still have a live picker?
  const pickers = new WeakMap();

  function setup(box) {
    const existing = pickers.get(box);
    if (existing) return existing;

    const label = box.querySelector(SEL_LABEL);
    if (!label) return null;

    const category = (label.textContent || "").trim();
    const naming = CATEGORIES[category] || {
      heading: category,
      add: "Add to " + category,
    };

    const picker = buildPicker(box, label, naming);
    pickers.set(box, picker);
    return picker;
  }

  /**
   * Re-asserts every combobox on the page, and clears up after Vue.
   *
   * This is a poll, not an observer, and that is the whole point. Two previous
   * versions tried to predict which node Vue would replace — first the picker
   * lived inside `.combobox` and was destroyed with it, then it lived outside
   * and was destroyed without the observer on `.combobox` ever seeing it. Both
   * failed the same way: adding a chip re-rendered something, the disclosure
   * button vanished and the native field came back unhidden.
   *
   * A sweep does not care which node was replaced. It costs four
   * `querySelectorAll`s twice a second and cannot be outsmarted by a render
   * pattern we have not seen yet.
   */
  function sweep() {
    for (const box of document.querySelectorAll(SEL_BOX)) {
      repairChips(box);
      const picker = setup(box);
      if (picker) picker.repair();
    }
    // Pickers orphaned by a combobox that was replaced outright.
    for (const wrapper of document.querySelectorAll("." + CLASS_PREFIX + "-picker")) {
      const previous = wrapper.previousElementSibling;
      if (!previous || !previous.matches(SEL_BOX)) wrapper.remove();
    }
  }

  // setTimeout chain rather than setInterval, and never requestAnimationFrame:
  // rAF is paused entirely while the tab is backgrounded, and a chain cannot
  // stack up if one pass ever runs long.
  const SWEEP_MS = 500;
  (function loop() {
    try {
      sweep();
    } catch (error) {
      debug("combobox", "sweep failed: " + (error && error.message));
    }
    window.setTimeout(loop, SWEEP_MS);
  })();

  // The sweep is the safety net; this makes the first pass immediate rather
  // than up to half a second after a panel appears.
  enhance(SEL_BOX, (box) => {
    repairChips(box);
    const picker = setup(box);
    if (picker) picker.repair();
  });

  /**
   * Builds the disclosure + add buttons that replace the dead native dropdown,
   * and returns an idempotent `repair()` that re-asserts the whole arrangement.
   *
   * The native control is left exactly as Roll20 built it. Two earlier versions
   * did interfere: one removed the `list` attribute, which deleted the picker
   * for anyone using a mouse, and one overrode the input's role. Only its
   * visibility to the accessibility tree changes.
   *
   * The buttons sit behind a disclosure and list only values not already added:
   * thirteen buttons after every field is its own kind of unusable, and an
   * entry that cannot be added again does not need offering.
   */
  function buildPicker(box, label, naming) {
    let warned = false;

    const wrapper = document.createElement("div");
    wrapper.className = CLASS_PREFIX + "-picker";
    wrapper.setAttribute("role", "group");
    wrapper.setAttribute("aria-label", naming.heading);

    const list = document.createElement("div");
    list.className = CLASS_PREFIX + "-picker-list";
    list.setAttribute("role", "list");
    list.setAttribute("aria-label", "Available " + naming.heading.toLowerCase());
    list.hidden = true;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = CLASS_PREFIX + "-sr-only-focusable";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", ensureId(list));
    toggle.textContent = "Choose " + naming.heading.toLowerCase();

    wrapper.appendChild(toggle);
    wrapper.appendChild(list);

    /** The live field — re-queried every time, because Vue replaces it. */
    function field() {
      return (
        box.querySelector('[role="combobox"]') || box.querySelector(SEL_INPUT)
      );
    }

    /** Values offered by the native datalist, read live. */
    function allOptions() {
      const datalist = box.querySelector("datalist");
      if (!datalist) return [];
      return Array.prototype.map
        .call(datalist.querySelectorAll("option"), (o) =>
          (o.value || o.textContent || "").trim()
        )
        .filter(Boolean);
    }

    function remaining() {
      return allOptions().filter((value) => !hasChip(box, value));
    }

    function render() {
      list.textContent = "";
      for (const value of remaining()) {
        const item = document.createElement("div");
        item.setAttribute("role", "listitem");

        const button = document.createElement("button");
        button.type = "button";
        button.className = CLASS_PREFIX + "-sr-only-focusable";
        button.textContent = value;
        button.setAttribute("aria-label", "Add " + value);
        button.addEventListener("click", (event) => {
          event.preventDefault();
          add(box, field(), value, naming.heading, toggle, api);
        });

        item.appendChild(button);
        list.appendChild(item);
      }
    }

    function setExpanded(open) {
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      list.hidden = !open;
      if (open) render();
      else list.textContent = "";
    }

    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      setExpanded(toggle.getAttribute("aria-expanded") !== "true");
    });

    // Escape collapses and puts focus back on the disclosure. Without this the
    // only way out of an expanded list is to find the toggle again, which is
    // exactly what was impossible when the toggle went missing.
    wrapper.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (toggle.getAttribute("aria-expanded") !== "true") return;
      event.preventDefault();
      setExpanded(false);
      toggle.focus();
    });

    /** Sets an attribute only if it would actually change. */
    function set(element, name, value) {
      if (element && element.getAttribute(name) !== value) {
        element.setAttribute(name, value);
      }
    }

    function unset(element, name) {
      if (element && element.hasAttribute(name)) element.removeAttribute(name);
    }

    const api = {
      /**
       * Re-asserts everything Vue may have undone.
       *
       * Called twice a second by the sweep, so every single step checks before
       * it writes. That is not tidiness: a redundant attribute write is a DOM
       * mutation, and a screen reader can react to those. A silent no-op pass
       * has to genuinely be silent.
       */
      repair() {
        // The heading Roll20 renders as a bare one-word caption. Made a real
        // heading so the category is announced before the list and can be
        // reached by heading navigation. Visible text untouched; only the
        // announced form is expanded.
        if (label.isConnected) {
          set(label, "role", "heading");
          set(label, "aria-level", "3");
          set(label, "aria-label", naming.heading);
          unset(label, "aria-hidden");
        }

        const input = field();
        if (!input) return;

        // Named for what it does rather than repeating the heading above it.
        if (!(input.getAttribute("aria-label") || "").trim()) {
          input.setAttribute("aria-label", naming.add);
        }

        // Park the picker immediately after `.combobox`. Whether Vue rebuilds
        // the combobox, its contents, or its parent, this puts the same node
        // back — the expanded state and the bound handlers survive with it.
        if (!wrapper.isConnected || wrapper.previousElementSibling !== box) {
          if (box.parentElement) box.insertAdjacentElement("afterend", wrapper);
        }

        const options = allOptions();

        // Hide the native control from the accessibility tree — but only once
        // there is a working replacement. A field with no alternative route is
        // better left audible than silently unreachable.
        //
        // `tabindex="-1"` goes with the `aria-hidden`: a hidden element that is
        // still tabbable is worse than either alone, because focus lands
        // somewhere the screen reader will not describe. Nothing changes for a
        // mouse user — the field still takes clicks, typing and its own popup.
        //
        // Skipped while the field holds focus: Chrome refuses `aria-hidden` on
        // an element containing the focused node, and `add()` focuses it for a
        // moment. The next sweep applies it once focus has moved on.
        const datalist = box.querySelector("datalist");
        if (options.length) {
          if (document.activeElement !== input) {
            set(input, "aria-hidden", "true");
            set(input, "tabindex", "-1");
          }
          set(datalist, "aria-hidden", "true");
        } else {
          unset(input, "aria-hidden");
          unset(input, "tabindex");
          // Once only — this runs twice a second, and a line per pass would
          // bury the report it is written into.
          if (!warned) {
            warned = true;
            debug(
              "combobox",
              naming.heading + ": no datalist options, native field left audible"
            );
          }
        }

        const count = remaining().length;
        const text = "Choose " + naming.heading.toLowerCase() + " (" + count + ")";
        if (toggle.textContent !== text) toggle.textContent = text;
        if (toggle.hidden !== !options.length) toggle.hidden = !options.length;

        // Keep an open list honest about what is still addable — but never
        // rebuild it out from under the button the user is currently on.
        if (
          toggle.getAttribute("aria-expanded") === "true" &&
          !list.contains(document.activeElement) &&
          !sameValues(list, remaining())
        ) {
          render();
        }
      },
    };

    return api;
  }

  /** Whether the rendered list already shows exactly `values`, in order. */
  function sameValues(list, values) {
    const shown = Array.prototype.map.call(
      list.querySelectorAll("button"),
      (b) => b.textContent
    );
    return shown.length === values.length && shown.every((v, i) => v === values[i]);
  }

  /** Whether `value` is currently one of this field's chips. */
  function hasChip(box, value) {
    const wanted = value.trim().toLowerCase();
    return Array.prototype.some.call(box.querySelectorAll(SEL_CHIP), (chip) =>
      (chip.textContent || "").trim().toLowerCase().startsWith(wanted)
    );
  }

  /**
   * Adds a value by driving the field exactly as typing would.
   *
   * Ordering matters and was the cause of entries landing only sometimes: Vue
   * processes the `input` event on its own tick, so dispatching Enter in the
   * same tick asked it to commit a value it had not yet seen. Enter now goes
   * out on a later tick, and `keypress`/`keyup` go with it, since which of the
   * three a handler listens for is not something to guess at.
   *
   * The result is read back from the chips rather than assumed, so what gets
   * announced is what actually happened.
   */
  function add(box, field, value, heading, focusTarget, picker) {
    if (!field) return;

    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    ).set;
    const before = hasChip(box, value);

    // The field is aria-hidden, and focusing a hidden element leaves a screen
    // reader with nowhere to be. It is unhidden for the moment it takes to
    // drive it, then hidden again by `repair()` once focus has moved away.
    field.removeAttribute("aria-hidden");
    field.focus();
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));

    // setTimeout, never requestAnimationFrame — rAF does not run at all while
    // the tab is backgrounded.
    window.setTimeout(() => {
      for (const type of ["keydown", "keypress", "keyup"]) {
        field.dispatchEvent(
          new KeyboardEvent(type, {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
          })
        );
      }
      field.dispatchEvent(new Event("change", { bubbles: true }));

      window.setTimeout(() => {
        // Leave no stray text behind in the field.
        if (field.value) {
          setter.call(field, "");
          field.dispatchEvent(new Event("input", { bubbles: true }));
        }
        // The activated button is about to leave the list, so focus goes back
        // to the disclosure — otherwise it falls through to the document body.
        // This must happen BEFORE the field is re-hidden: Chrome ignores
        // `aria-hidden` on an element that still contains focus.
        focusTarget.focus();
        picker.repair();

        if (hasChip(box, value) === before) {
          announce("Couldn't add " + value + ". Try typing it instead.");
        } else {
          announce(value + " added to " + heading.toLowerCase() + ".");
        }
      }, 150);
    }, 0);
  }
})();
