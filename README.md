# Roll20 Accessibility Helper

An unofficial Chrome extension that makes [Roll20](https://roll20.net) usable
without a mouse and with a screen reader.

Parts of Roll20's newer interface can only be operated by dragging, several
controls are unlabelled or named after the icon font's glyphs, its panels are
CSS grids with no table semantics, and the chat log reads as a column of loose
numbers. That locks out blind screen-reader users and anyone who cannot perform
a precise drag. This extension adds ordinary, focusable, labelled controls and
speaks what happens.

It covers **both** places you actually play:

- the standalone **character sheet** at `app.roll20.net/characters/sheet/…`
- a live **game session** (the VTT) at `app.roll20.net/editor/…`, including the
  floating character sheet inside it

> Unaffiliated with Roll20. This relies on Roll20's internal, undocumented DOM,
> which can change without warning.

---

## Contents

- [Installing](#installing)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Features — game session (VTT)](#features--game-session-vtt)
- [Features — character sheet](#features--character-sheet)
- [Sounds](#sounds)
- [How it works](#how-it-works)
- [Limitations](#limitations)
- [Development](#development)

---

## Installing

There is no build step and there are no dependencies. Load the folder as it is.

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this folder.
4. Open a Roll20 character sheet or launch a game.

That is the whole installation. The optional helper below changes nothing about
it.

### Optional: the NVDA silencer (Windows only)

When a dialog closes, focus goes back to the control that opened it and a screen
reader answers by reading that control *and* everything it sits inside — over
the top of the roll you were waiting for. No web page can get in front of that:
it is a focus event handled by the screen reader, not anything the page controls.

What can is NVDA's own controller API, which needs a Windows program to call it.
`native/` is that program — no window, no interface, one job: ask NVDA to stop
talking for the moment focus moves back.

```bash
bash native/install.sh          # WSL + the .NET SDK; builds and registers it
```

Everything works without it, just more noisily, and **it is never required**: no
host, another platform, NVDA not running, or JAWS instead all end in the
extension quietly not using it. There is no half-working state.

### Giving it to someone else

```bash
bash native/package.sh                          # ~15 MB, needs nothing installed
bash native/package.sh --framework-dependent    # ~1 MB, needs .NET 6+ there
```

Builds `dist/roll20-a11y/` — the extension plus a prebuilt helper and an
`INSTALL.md` written for someone who has never seen this repo. They copy the
folder, load it unpacked, and run `native\install.ps1` (plain Windows
PowerShell; no WSL, no SDK). On macOS or Linux they just skip that step.

The extension id is pinned in `manifest.json`, so it is the same wherever the
folder lives — which is what lets the helper's registration name it in advance.

**After changing any file, press Reload on the extension card *and* refresh the
Roll20 tab.** Both steps, every time — a content script already running in an
open tab is not replaced until the page reloads, and a stale script looks
exactly like a broken feature.

Requires Chrome 111 or newer (one component runs in the page's own JavaScript
world, which needs `"world": "MAIN"` support).

Chrome will list **"Communicate with cooperating native applications"** among the
permissions. That is the optional silencer above and nothing else; on a machine
without it, nothing uses it.

---

## Keyboard shortcuts

All shortcuts work **from anywhere on the page**, including while focus is
inside the character sheet's iframe. None of them move focus except
`alt+shift+<n>` and `alt+M`, which are meant to.

### Rolling

| Key | Does |
| --- | --- |
| `alt+A` | Roll with **Advantage** |
| `alt+S` | Roll **Normal** (Roll20 labels this control "Automatic") |
| `alt+Z` | Roll with **Disadvantage** |
| `alt+O` | Re-read the last roll result / the chat message you are on |

`alt+A` / `alt+S` / `alt+Z` change the sheet's roll mode in place and say which
mode you are now in. Focus does not move, so you can set the mode between one
roll and the next without leaving what you were doing.

### Quick dice — game session only

| Key | Rolls | Key | Rolls |
| --- | --- | --- | --- |
| `alt+1` | d4 | `alt+5` | d12 |
| `alt+2` | d6 | `alt+6` | d20 |
| `alt+3` | d8 | `alt+7` | d100 |
| `alt+4` | d10 | | |

Each sends `/r 1dN` to chat. You hear a roll sound the moment you press, and the
result is announced when it arrives.

### Roll shortcuts — game session only

| Key | Does |
| --- | --- |
| `alt+shift+S` | Open the skill dropdown and roll the chosen skill |
| `alt+shift+A` | Open the ability dropdown and roll a check or save |
| `alt+shift+I` | Roll initiative |
| `alt+shift+D` | Roll a death save |
| `alt+H` | Adjust your hit points on a slider |
| `alt+shift+H` | Speak your HP and AC |
| `alt+shift+T` | Speak your remaining spell slots |
| `alt+shift+R` | Type a dice formula and roll it (`/r`) |
| `alt+shift+E` | Open your character sheet, beep when it has loaded |

Skill and ability open a small dialog listing the options (18 skills, or the 12
ability checks and saves); the arrow keys move through them, Enter or Space
rolls, Escape closes without rolling. Each sends Roll20's macro form
`%{Character Name|attribute}` for your first controlled character, so
`alt+shift+S` → `%{Brother Lorian|perception}` and `alt+shift+D` →
`%{Brother Lorian|death_save}`.

`alt+shift+H` and `alt+shift+T` **send nothing** — they read your character out
of Roll20's own data model and speak the answer to you alone, so nothing appears
in the chat log and the rest of the table is none the wiser:

```
HP 12 out of 12, with 0 temp HP, AC is at 18.
Spell slots. Level 1: 2 of 2. Level 3: 1 of 3.
```

Levels you have no slots at are left out. Warlock pact slots are reported
separately, and without a total, because the sheet does not store one.

`alt+H` opens a slider over your hit points, from 0 to your maximum, starting
where you are now. The arrow keys move it a point at a time, Page Up and Page
Down ten, Home and End jump to either end, and the value is read out as you go
("9 of 20"). Enter applies it; Escape closes without changing anything. The
change is written to your sheet the same way typing into the sheet would write
it, and announced to the table:

```
Tempis: takes 3 damage, current HP is 9
Tempis: heals 4 hit points, current HP is 12
```

Only current HP changes — temporary HP is left alone rather than being spent for
you. `alt+shift+H` is the read-only twin and changes nothing.

`alt+shift+E` opens the floating character sheet and plays a short rising beep
once it has finished rendering, so you are not left guessing whether it is ready
to use. If it is already open it says so and does nothing else.

`alt+shift+R` opens a box for a dice formula and rolls it with `/r`. A formula
is one or more terms joined by `+` or `-`, where a term is `XdY`, `dY` (a
shorthand for `1dY`), or a plain number — so `2d6+3`, `d20-1`, `3d8` and `5` are
all valid, and `d` and `D` are interchangeable. Anything else is spoken as
invalid and not sent.

### Attacks — game session only

| Key | Does |
| --- | --- |
| `alt+W` | Open the attack dropdown and roll the chosen attack |
| `alt+shift+W` | Open the same list and roll that attack's **damage** |

The same dialog as the roll shortcuts, listing your attacks named with what they
will actually roll, worked out from your character rather than read off the
sheet — so the list is right whether or not a sheet is open:

```
alt+W                                     alt+shift+W
Sacred Flame - DEX 13                     Sacred Flame - damage 1d8
Longsword (One-Handed) - attack roll +5   Longsword (One-Handed) - damage 1d8+3
Unarmed Strike - attack roll +3           Unarmed Strike - damage 2 Bludgeoning
```

Proficiency, ability modifiers and save DCs are all computed the way the sheet
computes them, including expertise and half-proficiency.

### Chat — game session only

| Key | Does |
| --- | --- |
| `alt+[` | Previous message |
| `alt+]` | Next message |
| `alt+shift+[` | First message in the log |
| `alt+shift+]` | Last message in the log |
| `alt+O` | Re-read the message you are on |
| `alt+shift+C` | Type a message and send it |

The four navigation keys move a **reading cursor**, not focus — you can read
back through the whole log without losing your place in the sheet. A short tone
tells you when you have run off either end of the log (low for the start, high
for the end).

`alt+shift+C` opens a small input box, sends what you type, and returns focus
exactly where it was. Whoever you are currently speaking as (Roll20's
"speaking as" selector) is used unchanged.

### Sidebar — game session only

| Key | Does |
| --- | --- |
| `alt+shift+1` … `alt+shift+9` | Open the *n*th sidebar tab and focus its panel |

Numbered by the tabs actually visible to you, left to right — usually Chat, Art
Library, Journal, Compendium, Jukebox, Collections, Announcements, Settings. The
tab is announced by name when it opens, so you do not have to memorise which
number is which.

### Map grid — game session only

| Key | Does |
| --- | --- |
| `alt+M` | Focus the grid cell holding your token |

Jump to where your character stands, then walk the grid from there with the
**arrow keys** (or your screen reader's table navigation). If you control
several characters, it focuses the first and tells you how many are on the map;
if you have none, it says so. Pressing `alt+M` again re-reads the cell you are
standing on.

### Notifications — game session only

| Key | Does |
| --- | --- |
| `alt+shift+-` | Turn token movement/change announcements on or off (**off** by default) |
| `alt+shift+=` | Turn the readout of others' chat and rolls on or off (**on** by default) |

`alt+shift+-` controls the battle grid's spoken changes ("moved to F4", "took
damage: …", "turned to face west") and their tone. The grid itself stays up to
date either way — only the announcement is muted. `alt+shift+=` silences chat
messages and roll results that come from **other** players, sounds included;
your own messages and rolls are always read. Both choices persist across
reloads.

### Ready signal

Once a game has finished loading — the chat is live, the battle grid is built,
and the "speaking as" selector is populated — the extension plays a short rising
chime and says **"Table ready."**. That is your cue that the shortcuts are safe
to press, so you are not left guessing whether the page is ready yet.

On load the "As:" selector is also switched to your own character, so chat you
send goes out in-character instead of under your account name.

---

## Features — game session (VTT)

### Chat read one line per message

Roll20's own markup reads as a pile. A single initiative roll came out as:

```
Brother Lorian / Initiative / 7 / 2 / Details /
rolling 2d8+3( / 7 / 0 / + / 4 / 0 / )+3=14 / izatea (GM):…
```

Three separate causes, all fixed:

- each die is a value *next to a dice-font glyph*, and the glyph got read as a
  stray number;
- Roll20 renders the sender only on the **first** message of a run, so every
  following message was read with no idea who said it;
- a roll's numbers are spread across a collapsed disclosure.

Each message is now collapsed to **one line** — who, and either what they said
or the roll with its full breakdown:

```
Brother Lorian: Strength Check, with advantage. 1d20, 15, Strength +1. Total 16.
Punnaphoj: rolling 2d8+3, dice 7 and 4, total 14.
izatea (GM): ไหนลองแชทดูหน่อย
```

The character's name is used when there is one, falling back to the account
name. Nothing changes visually — the page looks exactly as it did.

New messages are announced as they arrive. Reloading a campaign does **not**
replay its history at you, and Roll20's habit of occasionally handling a sheet
roll twice no longer produces two announcements.

### Sidebar tabs you can reach and name

Roll20's tab strip names each tab after its icon font's glyph, so a screen
reader announces "chatTab", "assetsTab", "journalTab". Each tab is renamed from
Roll20's own tooltip text, and `alt+shift+<n>` jumps straight to one.

### Quieter, more informative rolls

Roll20 plays the same notification beep for every message. That is suppressed
for dice rolls only — ordinary chat still beeps — and replaced with something
that tells you more:

| What happened | Sound |
| --- | --- |
| You sent `/roll`, `/r`, or a `%{name|attribute}` macro from the chat box (or `alt+1`…`alt+7`) | roll sound, on the press |
| Someone else rolled | a distinct "other player rolled" sound |
| **A natural 20 or natural 1** | its own fanfare — whoever rolled it |
| You rolled anything else | nothing; you already know |

### The battle grid as a table

The VTT renders the battle map to an opaque canvas — no DOM, nothing a screen
reader can walk. The extension reads Roll20's own token model instead and builds
a screen-reader-only table at the end of the page: one cell per grid square,
each token placed where it stands, spoken as

```
Brother Lorian — 12 hit points, facing west, blinded, prone, F4
```

with an empty square reading `blank, A1`. Column letters are uppercase, row
numbers start at 1 from the top. Hit points are read only for characters
controlled by a player, so a GM's secret monsters do not leak them; facing and
active conditions (blinded, prone, …) are read for every token. A token larger
than one square fills every cell it covers.

The table stays in step with the sheet, and real changes are announced
directionally, each with a short tone: a token moved, placed or removed; a
hit-point change ("took damage: 7 hit points" / "healed: 15 hit points"); a
facing change ("turned to face west"); a condition gained or ended ("is
blinded" / "is no longer prone"); or a rename. Opening a character sheet just
to look does not announce anything. `alt+M` jumps focus to your own token, and
the arrow keys then walk the grid cell by cell.

### Relative position

Directly after the grid table is a **Relative position** section that answers
"how far, and in which direction, is everything else from me?" It measures from
your token and lists every other creature token as a distance and an o'clock
bearing taken relative to your facing — 12 o'clock is straight ahead, 3 to the
right, 6 behind, 9 to the left:

```
Orc — 20 feet, 12 o'clock
Goblin — 35 feet, 3 o'clock
```

Distance uses Roll20's own page scale and diagonal setting, so it agrees with
the ruler. The list is always live and reached by its heading.

### Terrain identification

Press the **Identify terrain** button (inside the "Map grid" section) and the
extension fetches the map's background image and asks a Gemini model to label
every square — `sand`, `wooden deck`, `stone pillar`, `water` — so a square reads
`sand, A1` and a token reads `… facing west, on wooden deck, F4`.

The first press asks for a **Gemini API key** (a `window.prompt`); it is stored
in the extension's own `chrome.storage.local` and cleared if Google rejects it.
Nothing is cached: every press re-fetches, and the image is downscaled before it
is sent.

---

## Features — character sheet

Everything here also applies to the floating character sheet inside a game.

| Feature | What it does |
| --- | --- |
| **Spoken roll results** | Every roll is announced through a "Last Result" region — title, total, and the breakdown read row by row, with zero-value bonuses dropped. `alt+O` repeats it. Roll20's Roll Log drawer normally opens on every roll and steals focus into itself; it is neutralised so focus never moves, and still opens normally when you ask for it from the nav. |
| **Roll mode shortcuts** | `alt+A` / `alt+S` / `alt+Z`, described above. |
| **SKILLS as a table** | Skill, Roll, Ability, Bonus and Proficiency become real table columns, so you can navigate by cell and hear the column headers. Proficiency exists only as a colour in Roll20's markup and is given text. |
| **ABILITIES as a table** | The six abilities become rows with Score, Modifier and Saving throw columns. |
| **The Combat tab, Spells, Inventory and Passive Senses as tables** | Attacks, Actions, Bonus Actions, Reactions, Free Actions, Weapon Masteries and Effects each become a real table with column headers, so you can navigate cell by cell. Rows genuinely differ in shape — an attack with no type, a collapsed skill, an action with no dice roll — so cells are pinned to their columns and missing ones leave a gap instead of shifting everything after them. An action's dice roll gets its own "Roll" column. |
| **Money denominations speak their total** | The Platinum / Gold / Electrum / Silver / Copper +/- steppers are named ("Increase Gold"), and pressing one announces the new total ("Gold: 5"). |
| **Named icon-only buttons** | Roll20's icon buttons are named after their glyph. They are renamed from surrounding context: "Show description", "Edit attack", "Roll damage", "Edit *panel*", "Damage", "Heal", "Send to chat". |
| **Named form controls** | The +/- spinbuttons, the equip toggles, the quantity steppers and the Weapon Mastery / Effects on-off switches get accessible names taken from the labels beside them. |
| **Advantage spoken** | The advantage/disadvantage badge is a colour and an icon; it now also says "with advantage" / "with disadvantage". |
| **Proficiencies & Languages** | The picker is an autocomplete whose options are never announced. A screen-reader-reachable list of "Add *X*" buttons is added alongside, grouped by category, and each addition is confirmed aloud. |
| **Dialog focus management** | Dialogs take focus on open, trap Tab, recover focus when Roll20 re-renders the control you were on, and return focus where it came from on close. |
| **Compendium → Add to Character** | Adds an **Add to Character** button to every Compendium result, replacing the mouse-only drag-and-drop needed to add an item. |

### Using the Compendium button

Open the Compendium panel, search, and Tab to any result — each one now has an
**Add to Character** button. Activating it performs the same sequence Roll20's
drag does, and announces whether the item was added. No mouse movement is
involved and results do not need to be scrolled into view.

---

## Sounds

Bundled in `sounds/`. Attribution and licence terms for each file are in
[`sounds/LICENSES.md`](sounds/LICENSES.md).

Chrome's autoplay policy means no sound plays until you have interacted with the
page at least once, which is always true by the time a roll happens.

---

## How it works

No build step, no dependencies, no framework — plain content scripts loaded
directly from this folder.

```
manifest.json                            Manifest V3 config
styles.css                               Shared styles (all `r20a11y-` prefixed)
lib/core.js                              Shared helpers, loaded first
lib/roll-format.js                       Reads a D&D 2024 roll template
features/<one-per-feature>.js            One feature per file
page/<shim>.js                           Runs in Roll20's own JS world
sounds/                                  Audio assets
```

Roll20's pages are rendered asynchronously and re-rendered freely, so features
never query the DOM once at startup. They register a selector with
`Roll20A11y.enhance()` and get called for every current *and future* match.
Every user-visible action reports its outcome through a visually-hidden
`aria-live` region, because Roll20's own toasts are not reliably announced.

Two structural points worth knowing:

- **The character sheet is a cross-origin iframe.** Shortcuts are registered in
  both the page and the sheet and forwarded across, because a keypress only
  reaches whichever frame has focus.
- **Two files run in Roll20's own JavaScript world** (`page/`). Roll20 plays its
  chat beep through an audio element it never puts in the document, so there is
  nothing for a normal content script to mute — and the battle-map model
  (`Campaign`, token positions, grid geometry, hit points) only exists there. A
  small bridge forwards that model to the isolated world, which does all the
  presentation. Those are the only reasons the `page/` directory exists.

Contributor notes, including the traps that produced real bugs, are in
[`CLAUDE.md`](CLAUDE.md).

---

## Limitations

- **Built against the D&D 2024 sheet** (`dnd2024byroll20`). Other sheets share
  the chat and sidebar work but not the sheet-panel tables.
- **Collapsing a chat message to one line hides what is inside it.** Links and
  the "Details" disclosure within a message are no longer reachable by a screen
  reader. That is the deliberate trade for one line per message.
- **Roll20 sometimes handles a sheet roll twice.** Its own notification sound
  still rings twice when that happens; nothing outside Roll20 can suppress it.
  The duplicate announcement is filtered out.
- A burst of more than five messages arriving at once is treated as history and
  not read aloud. Use `alt+shift+]` to catch up.
- **`/gmroll` is not treated as a roll command** by the roll sound; only `/roll`,
  `/r`, and the `%{name|attribute}` macro form.
- Compendium adding is verified end-to-end for **Items**. Spells, Feats and
  Features use the same code path but are less tested.
- **Terrain identification calls Google's Gemini API** with your own key. The
  map's background image is cropped and downscaled before it is sent, and
  nothing is stored — but it is a network call to a third party, so turn it off
  (just don't press the button) if that matters to you.
- This depends on Roll20's undocumented internals. It fails safe — if an
  expected element is missing it announces a plain failure rather than throwing
  or silently doing nothing — but a Roll20 deploy can break a feature.

---

## Development

There is no test suite; changes are verified by hand against the live page.
Before handing anything over:

```bash
for f in lib/*.js features/*.js page/*.js; do node --check "$f" || echo "FAIL $f"; done
python3 -c "import json;json.load(open('manifest.json'))"
```

Then reload the extension **and** refresh the Roll20 tab.

### Adding a feature

Create `features/your-feature.js`, add it to the right `content_scripts` entry
in `manifest.json` (after `lib/core.js`), and use `enhance()` to attach
controls. Keep the callback idempotent with `markOnce()`.

`window.Roll20A11y` provides:

| Helper | Purpose |
| --- | --- |
| `enhance(selector, onMatch)` | Calls `onMatch(el)` for every current **and future** match. |
| `markOnce(el, key)` | `true` the first time only — makes `onMatch` idempotent. |
| `waitForElement(selector, opts)` | Resolves when an element appears, or `null` on timeout. |
| `announce(message)` | Speaks a message through the shared live region. |
| `createButton({label, ariaLabel, onActivate})` | A consistently styled, keyboard-accessible button. |
| `labelFrom(el, parts, host)` | Names an element from live nodes, so the name cannot go stale. |
| `setColumn(el, index)` / `presentational(el)` | Table-semantics helpers. |
| `rollFormat` | Reads a D&D 2024 roll template into speakable text. |

Read [`CLAUDE.md`](CLAUDE.md) before changing anything in the sheet frame — it
documents the diagnosis route for a frame you cannot inspect, and the specific
mistakes that cost whole debugging cycles.
