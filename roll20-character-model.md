# Roll20 `Campaign.characters` Backbone Model — Reference

> Scope: D&D 2024 by Roll20 advanced character sheet (the current default D&D sheet).
> Other sheets (legacy D&D 5e, Pathfinder, etc.) use a completely different `repeating_*` section model.
> All paths assume you are **inside the Roll20 editor page** (`app.roll20.net/editor/`).

---

## 1. Accessing Characters

```javascript
// List all characters in the game
Campaign.characters.length            // number of characters

// Get one by ID
var char = Campaign.characters.get("-P-5RSzsauwJglx3IcQ9");

// Iterate all
Campaign.characters.each(function(c) {
  console.log(c.id, c.get("name"));
});
```

### Character top-level properties

| Key | Type | Notes |
|-----|------|-------|
| `id` | string | Server-side ID, e.g. `"-P-5RSzsauwJglx3IcQ9"` |
| `.get("name")` | string | Character display name |
| `attribs` | Backbone.Collection | All attributes (see below) |
| `abilities` | Backbone.Collection | Rollable abilities (usually empty on advanced sheets) |
| `d20` | object | Internal engine adapter (`d20.models.Character`, etc.) |
| `_blobcache` | object | Cached blobs (bio, defaulttoken) |
| `blobNodeName` | string | Firebase path key (`"char-blobs"`) |

---

## 2. Attributes

The attribute model has only **5 attributes** for the D&D 2024 sheet:

```javascript
char.attribs.models.map(a => a.get("name"))
// → ["store", "appState", "updateId", "sheetVersion", "builder"]
```

| Attribute | Type | Purpose |
|-----------|------|---------|
| `store` | object | **The main character data blob** (~100+ KB). Contains everything: stats, attacks, spells, inventory, etc. |
| `appState` | string | UI state (which tab is open, etc.) |
| `updateId` | string | Sync version counter |
| `sheetVersion` | number | Sheet version number |
| `builder` | object | Character builder data (creation wizard state) |

### Reading the store

```javascript
var char = Campaign.characters.get("-P-5RSzsauwJglx3IcQ9");
var store = char.attribs.models.find(a => a.get("name") === "store").get("current");
```

---

## 3. Store Structure (top-level keys)

```javascript
Object.keys(store)
// → [
//   "about", "actions", "attacks", "background", "bastion",
//   "campaignSettings", "character", "classLevel", "currencies",
//   "effects", "features", "hitpoints", "inspiration", "integrants",
//   "inventory", "notes", "npc", "rest", "settings",
//   "sheetToSheet", "shop", "spellSlots", "spells", "weaponMasteries"
// ]
```

### Key sub-sections

| Key | Contents |
|-----|----------|
| `store.about` | Personality traits, ideals, flaws, characteristics (age, alignment, height, etc.) |
| `store.hitpoints` | `{ currentHP, tempHP, deathSaves: { failures, successes, open } }` |
| `store.spellSlots` | `{ currentByLevel: { CANTRIP: 0, FIRST: 2, ... }, useSpellSlotOnCast: bool }` |
| `store.attacks` | `{ attackDisplayOrder: "[]" }` — display ordering only, no attack data here |
| `store.spells` | `{ displayOrder: [...], generalSpellSettings: {...} }` — display ordering, spellcasting config |
| `store.actions` | Display orders for action/bonus/free/reaction |
| `store.features` | Display orders for class features, feats, species traits |
| `store.settings` | Roll settings, encumbrance, combat hints, etc. |
| `store.integrants` | **THE CORE DATA** — see section 4 |

---

## 4. Integrants — The Core Data Model

Almost all character data lives in a flat dictionary:

```javascript
var integrants = store.integrants.integrants;
// → { "uuid-1": {...}, "uuid-2": {...}, ... }
```

This is a **plain object keyed by UUID** (not an array). In V8/Chrome, `Object.keys()` returns keys in insertion order, which may correlate with the display order on the sheet — but this is **not guaranteed** by the spec.

### Common integrant properties (all types)

| Property | Type | Description |
|----------|------|-------------|
| `_id` | string | UUID, matches the object key |
| `_enabled` | boolean | Whether this integrant is active |
| `type` | string | The integrant type (see table below) |
| `name` | string | Display name |
| `label` | string | Optional label/tag |
| `parentID` | string | UUID of parent integrant (e.g., spell → class, attack → item) |
| `childIDs` | string | JSON array of child UUIDs, e.g. `"[\"uuid1\",\"uuid2\"]"` — parse with `JSON.parse()` |
| `shortID` | string | Short display ID |
| `source` | string | Origin: `"Class"`, `"Species"`, `"Item"`, `"Features"`, `"Custom"`, `""` |
| `compendiumPageID` | string | Link to compendium entry |
| `createdTime` | number | Unix timestamp (ms) |
| `cascades` | object | Trigger cascade relationships |
| `relations` | object | Cross-references to other integrants |

### Integrant type counts (example character)

| Type | Count | Description |
|------|-------|-------------|
| `Skill` | 18 | All skills (Acrobatics through Survival) |
| `Condition` | 15 | Conditions (Blinded, Charmed, etc.) with `_active` flag |
| `Proficiency` | 14 | Proficiency entries |
| `Spell` | 13 | Spells known/prepared |
| `Upcasting` | 12 | Upcast modifiers for spells |
| `Item` | 12 | Inventory items with equip data |
| `Defense` | 16 | Resistances, immunities, vulnerabilities |
| `Roll Bonus` | 11 | Conditional roll bonuses (advantage, disadvantage, etc.) |
| `Features` | 8 | Class/species/feat features |
| `Speed` | 8 | Speed entries |
| `Damage` | 7 | Damage components (children of Attacks) |
| `Action` | 4 | Action/bonus/reaction/free action entries |
| `Attack` | 6 | Attack entries (weapons, spells-as-attacks) |
| `Spellcasting` | 3 | Spellcasting sources (class, feat, species) |
| `Ability Score` | 9 | Ability scores and overrides |
| `Hit Points` | 2 | HP entries (base, temp, etc.) |
| `Currency` | 5 | Coin types |
| Others | misc | Class, Class Level, Background, Species, Size, etc. |

---

## 5. Attack Integrants

```javascript
var attacks = Object.values(integrants).filter(i => i.type === "Attack");
```

### Attack schema

```jsonc
{
  "_id": "XT3Q2062yFaR-u9fr_aQI",
  "_enabled": true,
  "type": "Attack",
  "name": "Longsword (One-Handed)",
  "actionType": "Action",           // "Action", "Bonus Action", etc.
  "attack": {
    "type": "Melee",                // "Melee", "Ranged", "Spell Save", "Attack Save", "None"
    "abilityBonus": "Wisdom",       // which ability adds to attack roll (or null)
    "bonus": 0,                     // flat bonus to attack
    "proficiencyLevel": "Proficient" // if present
  },
  "save": {                          // only if attack.type involves a save
    "saveAbility": "Dexterity",
    "saveFormula": { ... },          // optional, for complex saves
    "onFail": "2d8 Radiant damage..." // optional description
  },
  "childIDs": "[\"f3065336-69b1-4588-b83f-90d4a4562221\"]",  // Damage children
  "parentID": "K1K60PvMnrQgMHmIOeWBm",  // Item UUID if weapon-based
  "source": "Item",                  // "Item", "Class", "Spell", "Custom", ""
  "label": "",
  "shortID": "I7otVDZBu",
  "createdTime": 1786817648853,
  "cascades": {},
  "relations": {}
}
```

### Attack type variants

| `attack.type` | Behavior |
|---------------|----------|
| `"Melee"` | Standard melee attack roll (d20 + ability + prof) |
| `"Ranged"` | Standard ranged attack roll |
| `"Spell Save"` | No attack roll; target makes a saving throw |
| `"Attack Save"` | Both an attack roll AND a saving throw |
| `"None"` | No attack roll (auto-hit or special) |

### Damage integrants (children of attacks)

```javascript
var damage = integrants["f3065336-69b1-4588-b83f-90d4a4562221"];
```

| Property | Type | Description |
|----------|------|-------------|
| `type` | `"Damage"` | Always "Damage" |
| `_diceCount` | number | Number of dice (e.g. `1`) |
| `diceSize` | string | Die size (e.g. `"d8"`, `"d10"`, `""` for flat) |
| `ability` | string | `"auto"` (use same as attack), `"none"`, or specific ability |
| `damageType` | string | `"Slashing"`, `"Radiant"`, `"Bludgeoning"`, `""` (untyped) |
| `parentID` | string | UUID of the parent Attack integrant |
| `overrideCrit` | boolean | Whether crit damage is overridden |
| `critDiceSize` | string | Extra crit die if overridden |

---

## 6. Spell Integrants

```javascript
var spells = Object.values(integrants).filter(i => i.type === "Spell");
```

### Spell schema

```jsonc
{
  "_id": "d6ecgcqMUyicJh6X54yAu",
  "type": "Spell",
  "name": "Guiding Bolt",
  "level": 1,                       // 0 = cantrip, 1-9 = spell level
  "school": "Evocation",            // "Evocation", "Abjuration", etc.
  "castingTime": "Action",          // "Action", "Bonus Action", "Reaction", "1 minute", etc.
  "components": {
    "verbal": true,
    "somatic": true,
    "material": false,
    "materialDescription": ""       // only if material = true
  },
  "concentration": false,
  "ritual": false,
  "_prepared": true,                // whether currently prepared
  "alwaysPrepared": false,          // always prepared regardless of prep count
  "source": "Class",                // "Class", "Species", "Features", "Custom"
  "parentID": "LqTGYnQ4Syei-XBEjXtE9",  // UUID of spellcasting source
  "childIDs": "[\"fn1RHYjMmhWKEgkiZmHzE\"]"  // Attack/integrant children
}
```

### Spell display order

```javascript
store.spells.displayOrder
// → ["[]", "[\"uuid1\",\"uuid2\"]", "[]", "[]", "[]", "[]", "[]", "[]", "[]", "[]"]
// Index 0 = Cantrips, 1 = Level 1, ..., 9 = Level 9
// Each is a JSON string of ordered UUIDs
```

---

## 7. Spellcasting Integrants

```javascript
var spellcastings = Object.values(integrants).filter(i => i.type === "Spellcasting");
```

| Property | Description |
|----------|-------------|
| `ability` | `"Wisdom"`, `"Intelligence"`, `"Charisma"` |
| `casterType` | `"full"`, `"half"`, `"third"`, `"other"` |
| `name` | Source name (e.g. `"Cleric"`, `"Magic Initiate"`) |
| `parentID` | UUID of the parent class/feat/species |

---

## 8. Skill Integrants

```javascript
var skills = Object.values(integrants).filter(i => i.type === "Skill");
```

| Property | Example |
|----------|---------|
| `name` | `"Acrobatics"` |
| `ability` | `"Dexterity"` |
| `custom` | `false` |

---

## 9. Ability Score Integrants

```javascript
var abilities = Object.values(integrants).filter(i => i.type === "Ability Score");
```

| Property | Description |
|----------|-------------|
| `ability` | `"Strength"`, `"Dexterity"`, etc. |
| `calculation` | `"Set Value"`, `"Standard Array"`, etc. |
| `valueFormula` | `{ flatValue: 15 }` or formula object |

---

## 10. Condition Integrants

```javascript
var conditions = Object.values(integrants).filter(i => i.type === "Condition");
```

| Property | Description |
|----------|-------------|
| `_active` | `true` if condition is currently applied |
| `defaultName` | System condition name |
| `name` | Display name (may be custom) |
| `custom` | `true` if user-created |

---

## 11. Roll Bonus Integrants

```javascript
var bonuses = Object.values(integrants).filter(i => i.type === "Roll Bonus");
```

| Property | Description |
|----------|-------------|
| `bonusCategory` | `"[\"Attacks\"]"`, `"[\"Saving Throws\"]"`, etc. (JSON string array) |
| `bonusName` | `"[\"Dexterity\"]"` — specific ability/skill |
| `bonusValue` | Numeric bonus amount |
| `bonusDetails` | `"Keep Lowest"` — special roll behavior |
| `diceCount` | Number of dice for roll modifications |
| `cascades` | Trigger conditions, e.g. `{ "blinded": "[\"Activate\"]" }` |

---

## 12. Defense Integrants

```javascript
var defenses = Object.values(integrants).filter(i => i.type === "Defense");
```

| Property | Description |
|----------|-------------|
| `damage` | `"Cold"`, `"Fire"`, etc. — damage type |
| `defense` | `"Resistance"`, `"Immunity"`, `"Vulnerability"` |

---

## 13. Item Integrants

```javascript
var items = Object.values(integrants).filter(i => i.type === "Item");
```

| Property | Description |
|----------|-------------|
| `weaponData` | `{ category: "Melee", training: "Martial", type: "Longsword" }` — **null on non-weapons.** `training` and `type` are what a `category: "Weapon"` Proficiency integrant matches against, so this is how you tell whether an attack adds the proficiency bonus. |
| `properties` | JSON string array, e.g. `"[\"Versatile (1d10)\"]"` |
| `armorData` / `shieldData` | The equivalents for armor and shields |
| `equipData` | Equipped state only — `{ equippable, equipped }`. Carries no weapon category. |
| `shieldData` | Shield-specific data |
| `cost` | Purchase cost |
| `weight` | Item weight |
| `quantity` | Stack count |
| `rarity` | `"Common"`, `"Uncommon"`, etc. |
| `description` | Item description text |

---

## 14. Hit Points

```javascript
store.hitpoints
// → {
//   "currentHP": 12,
//   "tempHP": 0,
//   "deathSaves": { "failures": 0, "successes": 0, "open": false }
// }
```

---

## 15. Spell Slots

```javascript
store.spellSlots.currentByLevel
// → {
//   "CANTRIP": 0, "FIRST": 2, "SECOND": 0, "THIRD": 0,
//   "FOURTH": 0, "FIFTH": 0, "SIXTH": 0, "SEVENTH": 0,
//   "EIGHTH": 0, "NINTH": 0
// }
```

---

## 16. Working with `childIDs`

Many integrants reference children via `childIDs` (a **JSON string**, not an array):

```javascript
var attack = integrants["XT3Q2062yFaR-u9fr_aQI"];
var childIDs = JSON.parse(attack.childIDs);
// → ["f3065336-69b1-4588-b83f-90d4a4562221"]

var damageChild = integrants[childIDs[0]];
// → Damage integrant
```

Parent → child relationships:
- `Attack` → `Damage` (damage components)
- `Spell` → `Attack` (spells that produce attacks, e.g. Sacred Flame)
- `Spell` → `Upcasting` (upcast modifiers)
- `Spell` → `Spellcasting` (spellcasting source)
- `Class` → `Spellcasting`, `Features`, `Proficiency`
- `Item` → `Attack` (weapon attacks)

---

## 17. Quick Reference — Common Queries

```javascript
// Get character
var char = Campaign.characters.get("CHARACTER_ID");

// Get store
var store = char.attribs.models.find(a => a.get("name") === "store").get("current");
var integrants = store.integrants.integrants;

// All attacks
Object.values(integrants).filter(i => i.type === "Attack")

// All prepared spells
Object.values(integrants).filter(i => i.type === "Spell" && i._prepared)

// Current HP
store.hitpoints.currentHP

// Spell slots remaining
store.spellSlots.currentByLevel

// Active conditions
Object.values(integrants).filter(i => i.type === "Condition" && i._active)

// All skills
Object.values(integrants).filter(i => i.type === "Skill")

// Ability scores
Object.values(integrants).filter(i => i.type === "Ability Score")

// All items
Object.values(integrants).filter(i => i.type === "Item")

// Damage for a specific attack
var attack = Object.values(integrants).find(i => i.type === "Attack" && i.name === "Longsword (One-Handed)");
var damageIDs = JSON.parse(attack.childIDs);
damageIDs.map(id => integrants[id]);
```

---

## 18. Mutating Character Data

### Reading store data (no sheet open required)

```javascript
var char = Campaign.characters.get("-P-5RSzsauwJglx3IcQ9");
var store = char.attribs.models.find(a => a.get("name") === "store").get("current");

// Direct read of HP, AC, spell slots, attacks, etc.
store.hitpoints.currentHP       // 12
store.spellSlots.currentByLevel.FIRST  // 2
Object.values(store.integrants.integrants).filter(i => i.type === "Attack")
Object.values(store.integrants.integrants).filter(i => i.type === "Spell" && i._prepared)
```

### Mutating HP (and other attributes) — the fast path (~150 ms)

Computed attributes (`hp`, `ac`, spell slots, ability scores…) live inside the **sheet worker**, which runs in a cross-origin iframe. The parent page talks to it over a `MessageChannel`:

- `relay.channel.port1` (parent side) ↔ `port2` (transferred into the sheet iframe at init)
- A `{type: "setComputed", property, args}` message on `port1` invokes the **sheet's own setter** — the exact same code path as typing a value into the sheet UI.
- The setter updates `store.hitpoints.currentHP` **and** `customMeta1` (the JSON blob that macros actually read), bumps `attributes.updateId`, persists to Firebase, and broadcasts to all other relays. No manual state juggling needed.

**Helper — call any relay method and await its response:**

```javascript
function relayCall(relay, charId, type, property, args = [], timeoutMs = 5000) {
  return new Promise((resolve) => {
    const reqId = `${type}_${property}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const listener = (e) => {
      if (e.data?.requestId === reqId) {
        relay.channel.port1.removeEventListener("message", listener);
        resolve(e.data); // {type:"computedValue", requestId, result} on success
      }
    };
    relay.channel.port1.addEventListener("message", listener);
    relay.channel.port1.postMessage({ type, characterId: charId, property, args, requestId: reqId });
    setTimeout(() => {
      relay.channel.port1.removeEventListener("message", listener);
      resolve({ timeout: true });
    }, timeoutMs);
  });
}
```

**Pick a live channel, then read/write:**

```javascript
const CHAR_ID = "-P-5RSzsauwJglx3IcQ9";
const char = Campaign.characters.get(CHAR_ID);

// The headless relay's channel is normally alive from page load; the visible
// relay's can be stale depending on page history. Ping to find one that answers.
let relay = null;
for (const r of [char.view.headlessRelay, char.view.relay]) {
  if (!r?.channel?.port1) continue;
  const ping = await relayCall(r, CHAR_ID, "getComputed", "hp", [], 2000);
  if (ping.result !== undefined) { relay = r; break; }
}

// Read current HP
const hp = (await relayCall(relay, CHAR_ID, "getComputed", "hp")).result; // {current, max}

// Set current HP to 11 — ~150 ms round trip incl. Firebase persist
await relayCall(relay, CHAR_ID, "setComputed", "hp", ["11"]);

// All other setters follow the same pattern:
await relayCall(relay, CHAR_ID, "setComputed", "hp_max", ["14"]);
await relayCall(relay, CHAR_ID, "setComputed", "hp_temp", ["3"]);
await relayCall(relay, CHAR_ID, "setComputed", "ac", ["20"]);
await relayCall(relay, CHAR_ID, "setComputed", "strength", ["15"]);       // full ability names
await relayCall(relay, CHAR_ID, "setComputed", "lvl1_slots_expended", ["1"]);
```

**Verified effects of one `setComputed` call (~150 ms total):**

| Effect | Timing |
|---|---|
| Worker's internal store + customMeta1 updated | immediate |
| Response returns fresh computed value | ~120–150 ms round trip |
| Backbone model (`custom_meta1`) updated | same tick |
| Firebase persisted | within the round trip |
| Open sheet UI re-renders with new value | live (verified) |
| Chat macros `@{Name\|hp}` resolve with new value | immediately |

(The old close-reopen cycle took ~5 s — roughly 35× slower.)

### What the hp setter does internally (from sheet.js source)

```javascript
// property "hp", invoked by setComputed with args=[newValue]
character.attributes.updateId = Tr();                                    // fresh change token
character.attributes.store.hitpoints.currentHP = Math.max(value, 0);     // store update
meta.hp ? meta.hp.current = value : meta.hp = { current: value };        // customMeta1 update
character.customMeta1 = JSON.stringify(meta);
await dispatch.update({ character });                                    // persist + broadcast
```

`@{Name|hp}` resolves through the worker's `hp` getter, which reads `customMeta1` **first** (`{"hp":{"current":X,"max":Y,"temp":Z}}`) and only falls back to computing from hit-point integrants when that JSON is missing/invalid. This is why keeping both the store and `customMeta1` in sync (as the setter does) makes everything consistent.

### Available computed properties (verified against a live D&D 2024 sheet)

| Property | Reads | Writable |
|---|---|---|
| `hp` | `{current, max}` | yes (current) |
| `hp_current` | number | yes |
| `hp_max` | number | yes |
| `hp_temp` | `{current, max}` | yes |
| `ac` | number | yes |
| `hit_dice` / `hit_dice_max` / `hit_dice_rolled` | number/object | — |
| `death_save_bonus` | number | — |
| `initiative_bonus`, `initiative_style`, `init_tiebreaker` | value | — |
| `inspiration` | 0/1 | — |
| `passive_wisdom`, `spell_save_dc` | number | — |
| `strength`, `dexterity`, `constitution`, `intelligence`, `wisdom`, `charisma` | score | yes (full names, not abbreviations) |
| `<ability>_base`, `<ability>_mod`, `<ability>_save_bonus`, `<ability>_save_mod` | number | — |
| `lvl1_slots_total` … `lvl9_slots_total` | number | yes |
| `lvl1_slots_expended` … `lvl9_slots_expended` | number | yes |
| `deathsave_succ1-3`, `deathsave_fail1-3` | 0/1 | — |
| `npc_str_save` etc. (abbreviations work here) | number | — |

Unknown property names simply never respond (the worker throws internally) — use the timeout in `relayCall` to detect that.

### Opening the Character Sheet

There are two ways to open a character sheet dialog:

**Method 1: `d20.engine.openCharacterForToken()`**

```javascript
// Opens the sheet for a character (requires the character to be in your journal)
d20.engine.openCharacterForToken("-P-5RSzsauwJglx3IcQ9");

// Opens the Bio & Info tab instead of the character sheet
d20.engine.openCharacterForToken("-P-5RSzsauwJglx3IcQ9", true);
```

Note: Despite the name, this works even if the character has no token on the map. It internally calls `char.view.showDialog("sheet")`.

**Method 2: `char.view.showDialog()`**

```javascript
var char = Campaign.characters.get("-P-5RSzsauwJglx3IcQ9");

// Opens the character sheet tab
char.view.showDialog("sheet");

// Opens the Bio & Info tab
char.view.showDialog("bio");
```

### Closing the Character Sheet

**Method 1: DOM close button (most reliable)**

```javascript
var closeBtn = document.querySelector('.characterdialog.asv .asv__close');
if (closeBtn) closeBtn.click();
```

**Method 2: Via the handout store**

```javascript
var char = Campaign.characters.get("-P-5RSzsauwJglx3IcQ9");
var store = char.view.journalStore;

// Toggle (closes if open, opens if closed)
store.toggleHandoutOpen(C.ui, {
  id: char.get("id"),
  name: char.get("name"),
  shortName: char.characterSheet.shortName
}, true);

// Close modal
store.closeModal();
```

### Checking if the Sheet is Open

```javascript
var frame = document.querySelector('#advanced-charsheet-dialog__charsheet');
var isOpen = frame && frame.offsetWidth > 0;

// Or check via the handout store
var char = Campaign.characters.get("-P-5RSzsauwJglx3IcQ9");
var handout = char.view.journalStore.$state.openHandouts.characterSheets["-P-5RSzsauwJglx3IcQ9"];
var isOpen = !!handout;
```

### What does NOT work

| Approach | Why it fails |
|----------|-------------|
| `char.attribs.find(a => a.get("name") === "hp").set("current", "9")` | Changes the backbone model, but macros don't read legacy attributes on advanced sheets. |
| `store.hitpoints.currentHP = 9` + `store.save()` alone | Updates Firebase, but the running worker keeps its in-memory copy and `customMeta1` (what macros read) is untouched. The value only appears after the sheet re-syncs store → customMeta1 (e.g. on reopen). |
| Writing `customMeta1` via `char.set(...)` + `state.updateCharacter(...)` manually | Macros update live, but the sheet's own init later re-writes customMeta1 from its store view, reverting your change. Always go through the worker's setter (`setComputed`) so both stay in sync. |
| `relay.methods.getComputed({characterId, attribute: "hp"})` | Wrong field name — the worker expects **`property`**, and this helper is fire-and-forget anyway. Post a raw `{type:"getComputed", property, requestId}` message and listen for the response instead. |
| Posting on `char.view.relay.channel` blindly | That channel object can be stale/dead depending on page history (each `relay.init()` creates a fresh MessageChannel; the iframe only accepts the first). Ping both relays and use whichever answers. |
| Direct Firebase writes | `PERMISSION_DENIED` — security rules block client writes to computed attribute paths. |
| `notifyWorkersOfAttrChanges()` | `activeWorkers` is `undefined` for advanced sheets — the worker lives in a cross-origin iframe, not a Web Worker. |
| Re-sending an `init` message to re-initialize the iframe | The iframe removes its window `message` listener right after the first init; subsequent init messages are never received. |

### Other relay methods

```javascript
// Raw message types accepted on relay.channel.port1 (worker-bound):
//   getComputed   { characterId, property, args, requestId }
//   setComputed   { characterId, property, args, requestId }
//   performAction { characterId, action, actionId, args, requestId }
//   subscribe     { characterId, requestId }
// Responses arrive on the same port with matching requestId:
//   computedValue { requestId, result }

relay.methods.getAvailableCharacters();   // list chars available to relay
relay.methods.getCharacterMacros({ characterId });
relay.methods.addToTracker({ characterId, initiative });
```

---

## 19. Important Caveats

1. **No public REST API.** This data is only accessible from within the Roll20 editor page's JavaScript context (via `Campaign.characters`).

2. **Cross-origin iframe.** The character sheet UI lives in an iframe at `advanced-sheets.production.roll20preflight.net`. You cannot access the iframe's DOM from the parent page, but you **don't need to** — all data is in the parent page's Backbone models, and mutations go through the relay.

3. **Integrants are an unordered object.** `Object.keys()` gives V8 insertion order, but this is not guaranteed to match the visual display order on the sheet. Always check `store.attacks.attackDisplayOrder` or `store.spells.displayOrder` for the true display order.

4. **`childIDs` is a JSON string**, not an array. Always `JSON.parse()` it.

5. **No reinitialization needed for mutations.** Computed attributes are mutated live via `setComputed` messages on a relay's MessageChannel (see section 18) — ~150 ms including Firebase persistence, with the open sheet UI and chat macros updating immediately. The old close-reopen cycle (~5 s) is obsolete.

6. **Macro syntax works.** `@{Tempis|hp}`, `@{Tempis|ac}` etc. resolve correctly for the D&D 2024 sheet once the relay is active and attributes are set. The old `repeating_attack_$0_attack` syntax also works in chat commands.

7. **Data is loaded when the game loads.** The `Campaign.characters` collection is populated at game join time. You do **not** need to open a character sheet for the data to be available.

8. **The `builder` attribute** contains the full character creation wizard state and is typically much larger (~260 KB) than the `store` (~116 KB). It mirrors much of the same data but in builder-specific format.

9. **Two relay types.** Relay "0" is the headless relay (created at page load, backed by a hidden `headless_sheet_frame_*` iframe). Relay "1" (and higher) are created when a sheet dialog is opened (backed by the visible `advanced-charsheet-dialog__charsheet` iframe). Each has its own MessageChannel to its own worker. **The headless channel is normally the reliable one** — it exists from page load and is never re-created. The visible relay's channel can be stale if the page history includes re-inits.

10. **Macros resolve without opening the sheet.** Chat macros like `@{Tempis|hp}` resolve through the headless worker's computed getters, which read `customMeta1` — kept in sync by every `setComputed` call. Opening the sheet is only needed for its UI; all reads and writes work headlessly via `getComputed`/`setComputed` (section 18).

11. **`customMeta1` is the macro source of truth.** The character's top-level `custom_meta1` attribute holds `{"hp":{"current":X,"max":Y,"temp":Z},"ac":{"total":N},"currency":[...]}`. Computed getters parse it first and fall back to store-derived values only when invalid. Don't write it directly — the sheet re-writes it from its store view on init; mutate through `setComputed` so both stay consistent.
