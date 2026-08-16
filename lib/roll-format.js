/**
 * Roll20 Accessibility Helper — reading a D&D 2024 roll template out loud.
 *
 * Roll20 renders the *same* `rolltemplate.dnd-2024` markup in two completely
 * different places:
 *
 *   the character sheet's Roll Log   `.chat-container__message > rolltemplate`
 *   the VTT's text chat              `.message > .sheetroll > rolltemplate`
 *
 * The wrappers differ; everything inside is identical. This file is that inside
 * part, so `features/last-result.js` and `features/vtt-chat.js` read a roll the
 * same way and there is only one place to fix when Roll20 changes the template.
 *
 * Everything here is pure: it takes an element and returns a string. Nothing is
 * mutated — `describeTemplate` clones before it strips — so a caller can pass a
 * live node straight out of the page.
 *
 * Loaded after `lib/core.js` and before any feature that uses it; it publishes
 * `window.Roll20A11y.rollFormat`.
 */
(function () {
  "use strict";

  function normalize(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function textOf(root, selector) {
    const el = root.querySelector(selector);
    return el ? normalize(el.textContent) : "";
  }

  /** ", with advantage" and friends, or "" when the roll was a plain one. */
  function modeSuffix(template) {
    const el = template.querySelector('[class*="dnd-2024__header--"]');
    if (!el) return "";
    const match = /dnd-2024__header--(\w+)/.exec(String(el.className));
    const mode = match && match[1];
    if (!mode || mode === "Normal") return "";
    if (mode === "Advantage") return ", with advantage";
    if (mode === "Disadvantage") return ", with disadvantage";
    return ", " + mode.toLowerCase();
  }

  /** "+0", "0", "-0" — a contribution that changes nothing. */
  function isZero(value) {
    const match = String(value).match(/-?\d+/);
    return !match || Number(match[0]) === 0;
  }

  /**
   * The breakdown, read row by row.
   *
   * Roll20's own text run together reads as an unpunctuated stream —
   * "1d20 20 Wisdom Bonus +3 Proficiency: +0 Total 23" — which a screen reader
   * delivers as one long number-laden phrase. Reading the rows individually
   * puts real boundaries in and lets the useless rows be dropped:
   *
   *   "1d20, 20, Wisdom Bonus +3. Total 23."
   *
   * Bonuses worth zero are omitted. Roll20 lists every possible contribution
   * whether or not it applies, so "Proficiency: +0" is on every unproficient
   * skill roll and says nothing.
   *
   * Returns "" when the list is not the shape we know, so the caller can fall
   * back to the raw text rather than emit something half-parsed.
   */
  function readBreakdown(template) {
    const list = template.querySelector(".dnd-2024__bonus-list");
    if (!list) return "";

    const parts = [];
    let total = "";

    for (const row of list.children) {
      if (!row.matches) continue;
      if (row.matches(".rt-formula")) {
        const raw = textOf(row, ".rt-formula__raw");
        const rolled = textOf(row, ".rt-formula__evaluated");
        const formula = [raw, rolled].filter(Boolean).join(", ");
        if (formula) parts.push(formula);
      } else if (row.matches(".bonus")) {
        const value = textOf(row, ".bonus__value");
        if (isZero(value)) continue;
        const label = textOf(row, ".bonus__label");
        parts.push(normalize(label + " " + value));
      } else if (row.matches(".total")) {
        total = normalize(
          textOf(row, ".total__label") + " " + textOf(row, ".total__value")
        );
      }
    }

    if (!parts.length && !total) return "";
    const body = parts.join(", ");
    if (!total) return body + ".";
    return body ? body + ". " + total + "." : total + ".";
  }

  /**
   * Three things Roll20 puts in the template that are never repeated, because
   * every one of them would otherwise be spoken on every single roll:
   *
   *   the character name    `.meta` — the caller already knows whose roll it is.
   *   the word "Details"    the `summary`; the disclosure is never opened.
   *   "Skill Breakdown"     `.bonus-list__header`, a label for what follows.
   */
  const SEL_NOISE = ".meta, summary, .bonus-list__header";

  /**
   * What to say for a `rolltemplate`, or "" when its shape is unrecognisable —
   * "" is the signal to fall back to raw text, not a roll with nothing in it.
   *
   * The total is dropped from the head when there is a breakdown, because the
   * breakdown already ends with "Total 23" and stating it up front said the
   * number twice. It is put back when there is no breakdown to carry it.
   */
  function describeTemplate(template) {
    // Cloned so this stays pure over a live node. Stripping a clone that the
    // caller already stripped is a no-op, so it is safe either way.
    const clone = template.cloneNode(true);
    clone.querySelectorAll(SEL_NOISE).forEach((node) => node.remove());

    const title = textOf(clone, ".header__title");
    const total = textOf(clone, ".die__total--preferred");

    let breakdown = readBreakdown(clone);
    if (!breakdown) {
      // The row shapes were not recognised. Fall back to the raw text, which is
      // ugly but complete — better than dropping a bonus silently. The heading
      // always ends in "Breakdown" and always comes first, so a wrapper that
      // escaped SEL_NOISE is still strippable.
      const details = clone.querySelector("details");
      const text = details
        ? normalize(details.textContent).replace(/^.{0,30}?Breakdown\s*/i, "")
        : "";
      if (text) breakdown = text + ".";
    }

    // Neither a title nor a number: this is not a shape we know. Say so with ""
    // and let the caller read the raw card, which is still better than a
    // failure message.
    if (!title && !total) return "";

    if (!breakdown) {
      // Nothing else carries the number, so the head has to.
      return [title, total].filter(Boolean).join(", ") + modeSuffix(clone) + ".";
    }
    return (title || total) + modeSuffix(clone) + ". " + breakdown;
  }

  /**
   * Returns "crit", "fail", or "" for a d20 formula and the values it produced.
   *
   * Silent when the formula produces more than one number, a shape not seen on
   * this sheet so far. Saying nothing on a genuine crit is a small loss; a
   * fanfare on an ordinary roll is a lie about what happened.
   */
  function judge(formula, values) {
    if (!/d20/i.test(formula)) return "";
    if (values.length !== 1) return "";
    const die = Number(values[0]);
    if (die === 20) return "crit";
    if (die === 1) return "fail";
    return "";
  }

  /**
   * "crit" / "fail" / "" for a `rolltemplate`, read from the d20's own rolled
   * value in the breakdown, not from the total, which includes the modifiers.
   *
   * Advantage and disadvantage need no special handling: Roll20 renders the
   * *kept* die as a plain `1d20` with a single value, so a disadvantaged 1 is
   * read as a 1 and correctly fires the fumble sound.
   */
  function critKindFromTemplate(template) {
    for (const formula of template.querySelectorAll(".rt-formula")) {
      const raw = textOf(formula, ".rt-formula__raw");
      if (!/d20/i.test(raw)) continue;
      return judge(raw, textOf(formula, ".rt-formula__evaluated").match(/\d+/g) || []);
    }
    return "";
  }

  window.Roll20A11y.rollFormat = {
    normalize,
    textOf,
    modeSuffix,
    readBreakdown,
    describeTemplate,
    judge,
    critKindFromTemplate,
  };
})();
