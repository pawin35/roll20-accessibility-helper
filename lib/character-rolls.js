/**
 * Attack rows derived from the D&D 2024 sheet's character model.
 *
 * Pure functions over a *list* of integrants — no DOM, no `chrome.*`, no
 * page-world objects — so the whole of the fiddly arithmetic can be exercised
 * offline against `test.json` without a browser. `page/character-bridge.js`
 * supplies the list; `features/attack-shortcuts.js` renders it.
 *
 * A list, deliberately, and not the `store.integrants.integrants` object it
 * comes from: the order of that object is what Roll20's
 * `%{Name|repeating_attack_$N_attack}` macro indexes, and an array cannot lose
 * it in transit the way an object's key order theoretically can.
 *
 * Everything below is checked against the reference character in `test.json`
 * and against live rolls in the test campaign — see "Attack roll shortcuts" in
 * CLAUDE.md for the transcript.
 */
(function () {
  "use strict";

  const ABILITIES = [
    "Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma",
  ];

  const ABBREV = {
    Strength: "STR",
    Dexterity: "DEX",
    Constitution: "CON",
    Intelligence: "INT",
    Wisdom: "WIS",
    Charisma: "CHA",
  };

  function signed(n) {
    return (n >= 0 ? "+" : "") + n;
  }

  function abbrev(ability) {
    return ABBREV[ability] || ability || "";
  }

  /** `childIDs` is a JSON *string*, and a malformed one must not throw. */
  function childIdsOf(integrant) {
    try {
      const parsed = JSON.parse((integrant && integrant.childIDs) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  // --- Ability scores ----------------------------------------------------
  //
  // Two passes, not one. `Set Base` assigns and `Modify` adds, and the two
  // kinds are interleaved in the store in no particular order — the reference
  // character has a background `Modify` for Wisdom sitting *before* the point
  // buy `Set Base` that would wipe it. Assigning everything first and then
  // applying the increases makes the result independent of that order.

  function abilityScores(list) {
    const scores = {};
    ABILITIES.forEach((ability) => {
      scores[ability] = 10;
    });

    const relevant = list.filter(
      (it) => it && it.type === "Ability Score" && it._enabled !== false
    );

    for (const pass of ["set", "modify"]) {
      for (const it of relevant) {
        if (!(it.ability in scores)) continue;
        const flat = it.valueFormula && it.valueFormula.flatValue;
        if (typeof flat !== "number") continue;
        const isModify = it.calculation === "Modify";
        if (pass === "set" && !isModify) scores[it.ability] = flat;
        if (pass === "modify" && isModify) scores[it.ability] += flat;
      }
    }
    return scores;
  }

  function abilityMods(list) {
    const scores = abilityScores(list);
    const mods = {};
    ABILITIES.forEach((ability) => {
      mods[ability] = Math.floor((scores[ability] - 10) / 2);
    });
    return mods;
  }

  function modOf(mods, ability) {
    return mods[ability] || 0;
  }

  /** The character's level is the highest `totalLevel` any Class Level carries. */
  function proficiencyBonus(list) {
    let level = 0;
    for (const it of list) {
      if (it && it.type === "Class Level" && typeof it.totalLevel === "number") {
        level = Math.max(level, it.totalLevel);
      }
    }
    return 2 + Math.floor((Math.max(level, 1) - 1) / 4);
  }

  /** How much of the proficiency bonus a given proficiency level is worth. */
  function proficiencyShare(level, pb) {
    if (level === "Not Proficient" || level === "None") return 0;
    if (level === "Expertise") return pb * 2;
    if (level === "Half Proficient") return Math.floor(pb / 2);
    return pb;
  }

  const PROFICIENCY_RANK = {
    "Not Proficient": 0,
    "None": 0,
    "Half Proficient": 1,
    "Proficient": 2,
    "Expertise": 3,
  };

  function rankOf(level) {
    return PROFICIENCY_RANK[level] !== undefined ? PROFICIENCY_RANK[level] : 2;
  }

  /**
   * Whether the character is proficient with the weapon behind an attack.
   *
   * `attack.proficiencyLevel` wins when it is there (Unarmed Strike states
   * "Proficient" outright). Otherwise the weapon is resolved through the
   * attack's `parentID` — a weapon attack hangs off its Item — and the Item's
   * `weaponData` gives both the training tier and the weapon's own name:
   *
   *     weaponData: { category: "Melee", training: "Martial", type: "Longsword" }
   *
   * Either can be what a Weapon-category `Proficiency` integrant names, so both
   * are matched: a class grants "Martial", a species might grant "Longsword".
   * The best matching level wins, so Expertise beats a plain proficiency.
   *
   * Returns "Proficient" when the weapon cannot be resolved at all — a spell
   * attack or a custom one with no Item behind it, which is proficient in
   * practice. But a weapon that *is* resolved and matches nothing is
   * "Not Proficient", which is the case this lookup exists to get right.
   */
  function weaponProficiencyLevel(attack, byId, list) {
    const stated = (attack.attack || {}).proficiencyLevel;
    if (stated) return stated;

    const item = byId[attack.parentID];
    const weapon = item && item.type === "Item" ? item.weaponData : null;
    if (!weapon) return "Proficient";

    let best = "Not Proficient";
    for (const it of list) {
      if (!it || it.type !== "Proficiency" || it._enabled === false) continue;
      if (it.category !== "Weapon") continue;
      if (it.proficiency !== weapon.training && it.proficiency !== weapon.type) continue;
      if (rankOf(it.proficiencyLevel) > rankOf(best)) best = it.proficiencyLevel;
    }
    return best;
  }

  // --- Save DCs ----------------------------------------------------------

  /** A `saveFormula`: a flat value, optionally plus an ability and proficiency. */
  function dcFromFormula(formula, mods, pb) {
    let total = typeof formula.flatValue === "number" ? formula.flatValue : 0;
    const ability = formula.ability;
    if (ability && ability.add && ability.ability) {
      const multiplier =
        typeof ability.multiplier === "number" ? ability.multiplier : 1;
      const share = modOf(mods, ability.ability) * multiplier;
      total += formula.round === "Up" ? Math.ceil(share) : Math.floor(share);
    }
    if (formula.proficiency && formula.proficiency.add) total += pb;
    return total;
  }

  /**
   * The ability behind a spell attack's save DC.
   *
   * A spell-derived Attack hangs off its Spell (`parentID`), and the Spell
   * hangs off the Spellcasting source that grants it — so "which ability sets
   * this DC" is two hops up. Falls back to the character's headline
   * spellcasting source when that chain is broken, which it is for several
   * spells whose Attack integrant is missing from the store entirely.
   */
  function spellcastingAbilityFor(attack, byId, list) {
    const spell = byId[attack.parentID];
    if (spell && spell.type === "Spell") {
      const source = byId[spell.parentID];
      if (source && source.type === "Spellcasting") return source.ability;
      for (const it of list) {
        if (it && it.type === "Spellcasting" && it.parentID === spell.parentID) {
          return it.ability;
        }
      }
    }
    for (const it of list) {
      if (it && it.type === "Spellcasting" && it.overviewDisplay) return it.ability;
    }
    for (const it of list) {
      if (it && it.type === "Spellcasting") return it.ability;
    }
    return null;
  }

  // --- The two labels ----------------------------------------------------

  /**
   * "DEX 13" for anything the target saves against, "attack roll +5" for a
   * roll, "" for an attack that is neither (True Strike's bonus damage).
   *
   * The abbreviation is `save.saveAbility` — the ability the *target* rolls —
   * not the ability that set the DC. That is why Sacred Flame reads "DEX 13"
   * off a Wisdom caster.
   */
  function attackLabel(attack, mods, pb, byId, list) {
    const save = attack.save;
    if (save && save.saveAbility) {
      const dc = save.saveFormula
        ? dcFromFormula(save.saveFormula, mods, pb)
        : 8 + pb + modOf(mods, spellcastingAbilityFor(attack, byId, list));
      return abbrev(save.saveAbility) + " " + dc;
    }

    const roll = attack.attack;
    if (!roll) return "";
    if (roll.type !== "Melee" && roll.type !== "Ranged") return "";

    const total =
      modOf(mods, roll.abilityBonus) +
      proficiencyShare(weaponProficiencyLevel(attack, byId, list), pb) +
      (roll.bonus || 0);
    return "attack roll " + signed(total);
  }

  /** An attack's first Damage child, or null. */
  function damageOf(attack, byId) {
    for (const id of childIdsOf(attack)) {
      const child = byId[id];
      if (child && child.type === "Damage") return child;
    }
    return null;
  }

  /**
   * "1d8+3", "2d8 Radiant", "2 Bludgeoning", "0 Radiant".
   *
   * `ability` says where the flat part comes from: `"auto"` reuses whatever
   * ability the attack roll uses, `"none"` adds nothing, anything else names
   * an ability outright. A damage with no dice is just its flat total, which
   * is how Unarmed Strike reads "2" and True Strike's bonus reads "0".
   */
  function damageLabel(damage, attack, mods) {
    if (!damage) return "";

    const dice = damage._diceCount || 0;
    const size = damage.diceSize || "";
    let flat = damage._bonus || 0;

    const ability = damage.ability || "none";
    if (ability === "auto") {
      flat += modOf(mods, (attack.attack || {}).abilityBonus);
    } else if (ability !== "none") {
      flat += modOf(mods, ability);
    }

    let text;
    if (dice && size) {
      text = dice + size;
      if (flat) text += signed(flat);
    } else {
      text = String(flat);
    }

    const damageType = damage.damageType || "";
    return damageType ? text + " " + damageType : text;
  }

  // --- The rows ----------------------------------------------------------

  /**
   * One row per Attack integrant, in the order the list arrived.
   *
   * Nothing is filtered and nothing is sorted: `index` is what Roll20's
   * `repeating_attack_$N_…` macro indexes, so dropping or reordering a single
   * row would silently roll the wrong attack.
   */
  function attackRows(list) {
    const byId = {};
    for (const it of list) {
      if (it && it._id) byId[it._id] = it;
    }
    const mods = abilityMods(list);
    const pb = proficiencyBonus(list);

    const rows = [];
    for (const it of list) {
      if (!it || it.type !== "Attack") continue;
      rows.push({
        index: rows.length,
        name: it.name || "",
        attackLabel: attackLabel(it, mods, pb, byId, list),
        damageLabel: damageLabel(damageOf(it, byId), it, mods),
      });
    }
    return rows;
  }


  // --- Spell slots -------------------------------------------------------
  //
  // Roll20 keeps how many slots are *left* in `store.spellSlots.currentByLevel`
  // and does not store the totals anywhere — the sheet computes them. Two
  // routes, both lifted from the sheet bundle so the numbers agree with what
  // the panel shows:
  //
  //   1. `Spell Slot` integrants, which is what the sheet uses for a character
  //      with a single spellcasting class: one per level, `Set Base` assigning
  //      and `Modify` adding.
  //   2. Roll20's slot table by caster level, which is what it uses when a
  //      character multiclasses. Transcribed verbatim from the bundle.
  //
  // The sheet picks by class count. We try (1) and fall back to (2) when it
  // yields nothing, because a store that has not fully loaded its `Spell Slot`
  // integrants would otherwise report "no spell slots" to a character who
  // plainly has some — a confidently wrong readout, which is worse than an
  // approximate one.

  const SLOT_LEVEL_KEYS = [
    "CANTRIP", "FIRST", "SECOND", "THIRD", "FOURTH",
    "FIFTH", "SIXTH", "SEVENTH", "EIGHTH", "NINTH",
  ];

  // casterLevel → slots at spell levels 1..9.
  const SLOT_TABLE = [
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [2, 0, 0, 0, 0, 0, 0, 0, 0],
    [3, 0, 0, 0, 0, 0, 0, 0, 0],
    [4, 2, 0, 0, 0, 0, 0, 0, 0],
    [4, 3, 0, 0, 0, 0, 0, 0, 0],
    [4, 3, 2, 0, 0, 0, 0, 0, 0],
    [4, 3, 3, 0, 0, 0, 0, 0, 0],
    [4, 3, 3, 1, 0, 0, 0, 0, 0],
    [4, 3, 3, 2, 0, 0, 0, 0, 0],
    [4, 3, 3, 3, 1, 0, 0, 0, 0],
    [4, 3, 3, 3, 2, 0, 0, 0, 0],
    [4, 3, 3, 3, 2, 1, 0, 0, 0],
    [4, 3, 3, 3, 2, 1, 0, 0, 0],
    [4, 3, 3, 3, 2, 1, 1, 0, 0],
    [4, 3, 3, 3, 2, 1, 1, 0, 0],
    [4, 3, 3, 3, 2, 1, 1, 1, 0],
    [4, 3, 3, 3, 2, 1, 1, 1, 0],
    [4, 3, 3, 3, 2, 1, 1, 1, 1],
    [4, 3, 3, 3, 3, 1, 1, 1, 1],
    [4, 3, 3, 3, 3, 2, 1, 1, 1],
    [4, 3, 3, 3, 3, 2, 2, 1, 1],
  ];

  /** Totals from the character's own `Spell Slot` integrants. */
  function slotTotalsFromIntegrants(list) {
    const totals = {};
    for (const it of list) {
      if (!it || it.type !== "Spell Slot" || it._enabled === false) continue;
      const level = it.spellLevel;
      if (typeof level !== "number" || level < 1 || level > 9) continue;
      const value = (it.valueFormula && it.valueFormula.flatValue) || 0;
      if (it.calculation === "Set Base") totals[level] = value;
      else totals[level] = (totals[level] || 0) + value;
    }
    return totals;
  }

  /**
   * Caster level for the table fallback.
   *
   * The sheet weighs each spellcasting class's own level (full counts fully,
   * half halves, third thirds) and only reaches the table when there is more
   * than one. Here the character's total level stands in for the per-class
   * levels, which is exact for a single class and an approximation for a
   * multiclass — and this is only the fallback path in the first place.
   * "other" and "pact" grant no slots on this table and are skipped.
   */
  function casterLevel(list) {
    let divisor = 0;
    for (const it of list) {
      if (!it || it.type !== "Spellcasting" || it._enabled === false) continue;
      const kind = String(it.casterType || "").toLowerCase();
      if (kind === "full") divisor = Math.max(divisor, 3);
      else if (kind === "half") divisor = Math.max(divisor, 2);
      else if (kind === "third") divisor = Math.max(divisor, 1);
    }
    if (!divisor) return 0;

    let level = 0;
    for (const it of list) {
      if (it && it.type === "Class Level" && typeof it.totalLevel === "number") {
        level = Math.max(level, it.totalLevel);
      }
    }
    if (divisor === 3) return level;
    if (divisor === 2) return Math.floor(level / 2);
    return Math.floor(level / 3);
  }

  function slotTotals(list) {
    const own = slotTotalsFromIntegrants(list);
    for (const level in own) {
      if (own[level]) return own;
    }
    const row = SLOT_TABLE[Math.min(Math.max(casterLevel(list), 0), 20)];
    const totals = {};
    row.forEach((count, i) => {
      if (count) totals[i + 1] = count;
    });
    return totals;
  }

  /**
   * `[{ level, remaining, total }]` for every level with a non-zero total,
   * ascending. Levels the character has no slots at are left out entirely.
   */
  function spellSlotRows(list, spellSlots) {
    const current = (spellSlots && spellSlots.currentByLevel) || {};
    const totals = slotTotals(list);
    const rows = [];
    for (let level = 1; level <= 9; level++) {
      const total = totals[level] || 0;
      if (!total) continue;
      rows.push({
        level,
        remaining: current[SLOT_LEVEL_KEYS[level]] || 0,
        total,
      });
    }
    return rows;
  }

  /** "Spell slots. Level 1: 2 of 2. Level 3: 1 of 3." */
  function spellSlotText(list, spellSlots) {
    const rows = spellSlotRows(list, spellSlots);
    const parts = rows.map((row) => "Level " + row.level + ": " + row.remaining + " of " + row.total + ".");

    // Warlock pact slots are a separate pool the table above does not describe.
    // Only what is left is known, so only that is said — silently dropping them
    // would be worse than reporting them without a total.
    const pact = (spellSlots && spellSlots.currentPactByLevel) || {};
    for (let level = 9; level >= 1; level--) {
      const left = pact[SLOT_LEVEL_KEYS[level]] || 0;
      if (left) {
        parts.push("Pact magic: " + left + " at level " + level + ".");
        break;
      }
    }

    if (!parts.length) return "You have no spell slots.";
    return "Spell slots. " + parts.join(" ");
  }

  // --- Hit points and armour class ---------------------------------------

  /**
   * "HP 12 out of 12, with 0 temp HP, AC is at 18."
   *
   * Read from Roll20's own computed summary (`custom_meta1`), falling back to
   * `store.hitpoints` for the live current and temporary values. Maximum HP has
   * no fallback: it is hit dice plus Constitution plus every bonus, and the
   * store does not hold it anywhere, so the sentence simply omits it.
   */
  function stateText(meta, hitpoints) {
    const hp = (meta && meta.hp) || {};
    const ac = (meta && meta.ac) || {};

    const current = hp.current != null ? hp.current : hitpoints && hitpoints.currentHP;
    const max = hp.max;
    const temp = hp.temp != null ? hp.temp : (hitpoints && hitpoints.tempHP) || 0;
    const armour = ac.total;

    if (current == null && armour == null) return "";

    const parts = [];
    if (current != null) {
      parts.push(max != null ? "HP " + current + " out of " + max : "HP " + current);
      parts.push("with " + (temp || 0) + " temp HP");
    }
    if (armour != null) parts.push("AC is at " + armour);
    return parts.join(", ") + ".";
  }

  /** "Longsword (One-Handed) - attack roll +5" */
  function attackText(row) {
    return row.attackLabel ? row.name + " - " + row.attackLabel : row.name;
  }

  /** "Longsword (One-Handed) - damage 1d8+3" */
  function damageText(row) {
    return row.damageLabel ? row.name + " - damage " + row.damageLabel : row.name;
  }

  window.Roll20A11y.characterRolls = {
    abilityScores,
    abilityMods,
    proficiencyBonus,
    attackRows,
    attackText,
    damageText,
    spellSlotRows,
    spellSlotText,
    stateText,
  };
})();
