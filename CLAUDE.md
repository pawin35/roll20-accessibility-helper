# CLAUDE.md

Guidance for working in this repo.

## What this is

**Roll20 Accessibility Helper** — an unofficial Manifest V3 Chrome extension
that makes Roll20's **character sheet** and its **VTT game session** usable with
a keyboard and a screen reader: table semantics for the sheet's panels, names
for its icon-only controls, spoken roll results that do not steal focus, a text
chat read one line per message with its own navigation keys, and keyboard
replacements for mouse-only interactions such as compendium drag-and-drop.

No build step, no dependencies, no framework. Plain content scripts loaded
directly from this folder as an unpacked extension.

## Layout

```
manifest.json                            MV3 config; content_scripts.js order matters
styles.css                               all classes namespaced `r20a11y-`
lib/core.js                              shared helpers, MUST load first
lib/roll-format.js                       reads a dnd-2024 rolltemplate; after core
lib/grid-geometry.js                     shared grid math (cellOf, cellsOf, …); after core
features/<one-file-per-feature>.js       features
page/<shim>.js                           runs in the PAGE's world, not ours
```

**`page/` is not `features/`.** Anything in there is registered with
`"world": "MAIN"` and runs in Roll20's own JavaScript context: no `chrome.*`, no
`window.Roll20A11y`, none of the isolated world's globals. It exists only for
things that genuinely cannot be done from a content script — currently four
things: suppressing Roll20's chat beep on a roll, the battle-grid bridge (see
below), which needs `Campaign`, a page-world-only object, the character-model
bridge (`character-bridge.js`, which needs the same `Campaign`), and
suppressing a programmatic focus during synthetic activation
(`suppress-focus.js` — see "Focus suppression" under Critical invariants).
Reach for it last.

Five `content_scripts` entries covering **two different Roll20 pages** plus the
sheet iframe, which is embedded in both of them. The VTT and the sheet each have
a page-world (`world: MAIN`) entry alongside their isolated-world one:

| Entry | Frame | Holds |
|---|---|---|
| `app.roll20.net/characters/sheet/*` | top | compendium drag-and-drop replacement, icon labels, the roll log and the "Last Result" box |
| `app.roll20.net/editor/*` | top | the VTT: sidebar tabs, the text chat, roll-mode keys |
| `app.roll20.net/editor/*` (`world: MAIN`) | top, page world | four shims: the chat-beep suppressor, the focus suppressor, the battle-grid bridge, and the character-model bridge |
| `advanced-sheets.production.roll20preflight.net/*` (`all_frames`) | sheet | everything about the sheet itself |
| `advanced-sheets.production.roll20preflight.net/*` (`world: MAIN`, `all_frames`) | sheet, page world | the focus suppressor (`suppress-focus.js`) |

The **character sheet page** and the **VTT** are different pages with almost
nothing in common. The character sheet has a Roll Log drawer; the VTT has
`#textchat`. The VTT is old jQuery/jQuery-UI code, not Vue. What they share is
the sheet iframe: on the VTT it is the *floating character sheet*, same origin,
same content scripts, so every sheet feature works in a game session too.

Several files are listed in **more than one** entry and branch on
`window.top === window`:

- `icon-button-labels.js` — both frames name icons the same way.
- `last-result.js` / `roll-mode-keys.js` — the thing being read or clicked is in
  one frame, the key that triggers it is pressed in whichever frame has focus.
- `vtt-sidebar-tabs.js` / `vtt-chat.js` — same reason, except the acting frame
  is the *VTT* top frame. Their sheet halves are also loaded on the character
  sheet page, where the posts reach a parent with no listener and do nothing.
  That is deliberate: the sheet frame cannot tell which page embeds it.
- `map-grid.js` — the grid lives in the VTT top frame, but `alt+M` (jump to my
  token) is forwarded from the sheet frame, so its sheet half only forwards the
  key and listens for the failure reply.
- `roll-shortcuts.js` — the roll shortcuts (`alt+shift+S`/`A`/`I`/`D`/`H`), same
  split as the chat keys: the sheet half forwards the key, the top frame sends
  or opens the modal, and the "done" reply is the sheet's cue to take focus
  back.
- `attack-shortcuts.js` / `open-sheet.js` — the same split again, for `alt+W` /
  `alt+shift+W` and `alt+shift+E`.

All content scripts share one isolated-world global scope. `lib/core.js`
publishes `window.Roll20A11y`; `lib/grid-geometry.js` adds `gridGeom` to it;
feature files consume both and must be listed **after** them in `manifest.json`.

## Testing — you must reload AND refresh

There is no test suite. Changes are verified by hand in Chrome:

1. `chrome://extensions` → **Reload** on the extension card.
2. **Refresh the Roll20 tab.**

Both steps, every time. A content script already running in an open tab is
*not* replaced when the extension reloads — the page must reload too. Skipping
step 2 produces a stale script that silently ignores your changes, which looks
exactly like a broken feature. This burned us repeatedly.

Claude cannot open `chrome://extensions` (browser-internal pages are blocked
from automation), so **ask the user to do the reload** and then verify against
the live page.

Before handing anything over, at minimum:

```bash
for f in lib/*.js features/*.js page/*.js; do node --check "$f" || echo "FAIL $f"; done
python3 -c "import json;json.load(open('manifest.json'))"
```

Bump `version` in `manifest.json` with anything user-visible. It is the only way
to tell from `chrome://extensions` whether the reload actually took.

## Diagnosing the sheet frame

### The problem

When a selector is wrong here, **nothing tells you**. Nothing throws, nothing
logs anywhere reachable, and the page looks identical — which is the same
symptom as forgetting to refresh the tab. Everything below exists because that
ambiguity cost several full cycles each time it came up.

Why the usual routes are all closed:

- the sheet is a **cross-origin iframe**, so `iframe.contentDocument` is `null`
- the **accessibility tree stops** at the frame boundary, so `read_page` cannot
  see in
- **`read_console_messages` cannot see content-script logs** at all — it only
  surfaces page-context messages. This one is easy to design a whole diagnostic
  around before discovering it, which is exactly what happened.

### The channel

`lib/core.js` carries a `debug(tag, message)` and a `DEBUG` flag. In the sheet
frame `debug()` `postMessage`s to the parent; the top frame's bridge appends the
line to a hidden `#r20a11y-report` div. That div **is** readable from the page
world, so it is the only way out:

```js
// javascript_tool, top frame
document.getElementById("r20a11y-report").textContent;
```

`DEBUG` ships `false`. Set it to `true` in `lib/core.js` and every feature
starts narrating — each one already calls `debug()` at the point where it
commits to a decision, so no other setup is needed.

Strip `=`, `;` and `?` from anything returned: they trip the browser tool's
query-string filter, which blocks the **entire** result rather than the match.
`clean()` in `lib/core.js` does this.

### Rebuilding the probe

A `features/diagnostics.js` is written when there is a question, listed **first**
in the iframe entry of `manifest.json`, and **deleted once the question is
answered** — it is scaffolding, not a feature. Rebuild it with:

- a **heartbeat line first**, before any selector runs. Without it, silence is
  ambiguous: script never injected, or injected and matched nothing? Those need
  opposite fixes.
- `describe(el)` → tag, classes, `role`, `aria-*`, `data-*`, and leaf text; and
  a recursive `outline(el, depth)` with a depth budget of **at least 10**. Roll20
  nests item rows deeply and a shallower budget truncates precisely the part in
  question. Print a structured outline, never `outerHTML`.
- `cloneNode(true)` on first sight, so the dump is Roll20's markup and not a mix
  of theirs and ours.

Four traps, each of which produced a wrong conclusion at least once:

- **Never gate on visibility.** A closed tab's rows are in the DOM at `0x0`.
  Five consecutive spell probes came back empty because of an `offsetWidth`
  check, and `.spell-item` had been right the first time.
- **Dump every match, not the first.** The first `.span--item-row-title` on the
  page belongs to combat EFFECTS, not spells, because effects render earlier.
- **Poll for tabs that have never been opened.** Unlike spells, the inventory
  tab is not in the DOM at all until visited, so a one-shot timer reports
  "nothing here" and says nothing about the selector.
- **Panels can be duplicated.** `.skills__skillList` is a hidden `0x0` copy while
  the real one is `.skills__panel`. Print `offsetWidth x offsetHeight` next to
  everything, or you will confidently transform the invisible one — this was
  reported as working for three cycles before the sizes gave it away.

### The cycle

1. Write the change; run the static checks above.
2. **Ask the user to reload the extension and refresh the tab.** Only they can
   do this — `chrome://extensions` is blocked from automation.
3. The user reports what their screen reader says.
4. Read `#r20a11y-report` for the frame's own account.
5. Fix, and go round again.

Step 3 is the ground truth, not step 4 and not a self-audit. More than once an
internal check reported a table built correctly while the user heard nothing,
because the table was in a hidden duplicate panel. **Never report a sheet-frame
change as working on the strength of the code alone.**

## Roll results and the Roll Log

Rolls are announced by `features/last-result.js`. The `rolltemplate` itself is
parsed by **`lib/roll-format.js`**, shared with `features/vtt-chat.js`, because
Roll20 renders the identical `dnd-2024` template in the Roll Log and in the
VTT's chat with only the wrapper differing. Change the template parsing there,
not in either feature.

The thing to understand
before touching it is that **the Roll Log is in the top frame**, not the sheet
— so unlike almost everything else here it is ordinary, scriptable,
inspectable DOM. `javascript_tool` can read it directly; no report bridge
needed.

| Thing | Where |
|---|---|
| The drawer | `[data-testid="test-roll-log-drawer"]`, `role="dialog"`, `aria-modal="true"` |
| Open/closed | `drawer.checkVisibility({checkVisibilityCSS: true})` |
| Nav control that opens it | `button.roll-log-button` |
| An entry | `.chat-container[data-messageid]`, newest **last** |
| Entry body | `.chat-container__message` (the container itself also holds avatar initials and a timestamp) |
| A sheet roll | contains `rolltemplate`; title `.header__title`, mode class `dnd-2024__header--Normal\|Advantage\|Disadvantage` |
| Its breakdown | `.dnd-2024__bonus-list` → `.rt-formula__raw` / `.rt-formula__evaluated`, `.bonus__label` / `.bonus__value`, `.total__label` / `.total__value` |
| A dice-tray roll | **no** `rolltemplate` — `.roll-result__main` with `.roll-result__formula`, `.roll-result__results .roll`, `.roll-result__total-number` |

Facts that shaped the design, each learned the hard way:

- **Capture from the log, never by intercepting roll buttons.** Roll controls
  are spread over five unrelated selector families; every one of them lands here
  as an entry. Do not add a per-button interception path — a new roll control
  anywhere on the sheet is covered for free. (The *sound* is the one exception:
  it must fire on the press, so it does use a selector list, and a control
  missing from it costs a silent second, not a lost result.)
- **Entries survive closing**, and the drawer body does not exist at all until
  the drawer first opens.
- **Do not close the drawer to get rid of it.** Element Plus restores focus to
  the `<iframe>` element, and a screen reader re-enters the sheet *from the top
  of the page*. This is worse than leaving it open. Hiding it with
  `display: none` makes its focus trap a no-op instead — a hidden element cannot
  be focused — after which closing it is harmless, because the restore lands on
  something that already has focus and fires no event.
- **Stripping the focus trap's `tabindex` does not work**: the trap falls
  through to the close button. Verified, not assumed.
- The **advantage/disadvantage** case needs no special handling: Roll20 renders
  only the *kept* die, as a plain `1d20` with a single value.
- **`aria-modal="true"` blanks the rest of the page** for a screen reader while
  the drawer is genuinely open, including our own live region. Anything spoken
  has to wait until it is closed or hidden.

## The character sheet's panel tables

The sheet's panels are CSS grids with no table semantics; the features named
`*-table.js` apply ARIA roles in place (see "SKILLS is a five-level CSS subgrid
chain" under Critical invariants for why never a real `<table>`). The COMBAT tab
is the densest case, covered by four files:

| Section | Row selector | List selector | Feature |
|---|---|---|---|
| Attacks | `.attack-item` | `.attacks__list` | `attacks-table.js` — the reference; do not change |
| Actions / Bonus / Reactions / Free | `.action-item` | `.actions__list` | `actions-table.js` (one file, four lists) |
| Weapon Masteries | `.weapon-mastery` | bare `.poly-list` (no class of its own) | `masteries-table.js` |
| Effects | `.effect-item` | `.effects__list` | `effects-table.js` |

Columns: actions `["Action", "Roll", "Details", "Actions"]`, masteries
`["Name", "Property", "Source", "Actions"]`, effects `["Effect", "Mod",
"Affects", "Actions"]`. The four action lists differ only by their section class
(`.combat__actions`, `.combat__bonus-actions`, `.combat__reactions`,
`.combat__free-actions`); the table's `aria-label` is read back from each
section's own `.section-header__main-header` rather than hard-coded.

Decisions worth preserving:

- **An action's dice roll is its own column.** `.action-item__buttons` sits
  *inside* the name's `.action-item__drag-name-and-resources` wrapper. Left
  there it is a button buried in the row header: table navigation reads a cell
  as one unit and never reaches it as a separate stop. The wrapper is made
  presentational, the name becomes the rowheader, and the dice a `role="cell"`
  in column 2; rows with no dice get a filler cell (the same gap-filling pattern
  as `attacks-table.js`). The button is also named "Roll 1d4" via `labelFrom`,
  matching how `attack-labels.js` names damage rolls.
- **The chat button is nested in the row header of every table — including
  Attacks.** That is the accepted pattern. It is reachable by Tab, not by table
  navigation, and no one has asked to change it.
- **The Weapon Masteries / Effects on-off switches stay nested in the row
  header** (for now). They are labelled (`aria-labelledby` → the weapon/effect
  name, so "Handaxe, switch, on/off") but were deliberately *not* promoted to
  their own column like the dice. If table-nav reachability of the switch ever
  matters, that is the same fix the dice got.

### Money steppers (`features/currency.js`)

The INVENTORY tab's purse renders five `.edit-purse__currency-edit`
denominations — Platinum, Gold, Electrum, Silver, Copper — each an incrementer:
name in the label, value in the input (`input.value`), and two unlabelled
increment/decrement buttons. Match them through **`Roll20A11y.INCREMENTER`**,
never a literal class — see "Roll20's two number steppers" below. The buttons are named
"Increase/Decrease *X*", and every change is spoken "*X*: *n*" through the shared
live region. Two mechanisms, both because Vue re-renders freely:

- labelling runs in a 500 ms `setTimeout` sweep (the `combobox-labels.js`
  pattern), idempotent so a no-op pass writes nothing;
- announcements are wired by document-level capture listeners on `click` and
  `input`, with a `WeakMap` per-denomination dedupe and a `setTimeout(0)` before
  reading the value, so the read lands after Vue commits the change.

`features/combat-control-labels.js` labels the two remaining unlabelled controls
in the combat sections: the Weapon Mastery chat button (`.weapon-mastery__chat-button`,
the one chat button Roll20 ships with no glyph name) and the toggle switches.

## The VTT (`app.roll20.net/editor/*`)

A campaign session. Unlike the character sheet this is **ordinary same-origin
DOM** — `javascript_tool` can read and drive all of it directly, no report
bridge, no probe. Use that; it is far faster than anything the sheet frame
needs. (The floating character sheet inside it is still a cross-origin iframe
and still needs all the sheet-frame machinery.)

### The sidebar

| Thing | Where |
|---|---|
| Sidebar | `#rightsidebar` — a **jQuery UI tabs** widget |
| Tab list | `#rightsidebar > ul.tabmenu`, `role="tablist"` |
| A tab | the **`<li>`** — `role="tab"`, `title="Chat"`, `aria-controls`, `aria-selected`, roving `tabindex`, `.ui-tabs-active` when current |
| Its panel | a sibling of the nav, id from `aria-controls`; already `role="tabpanel"`; hidden ones measure 0x0 |

Traps:

- **The `<li>` is the tab, not the `<a>`.** The `<a>` inside is
  `role="presentation" tabindex="-1"`, and **clicking the `li` does not switch
  panels** — jQuery UI binds its handler to the `<a>`.
- **Every tab announces as its icon glyph.** The `li`'s `aria-labelledby` points
  at that `<a>`, whose text is the icon font's token — `chatTab`, `assetsTab`,
  `journalTab`, `compendiumTab`, `jukeboxTab`, `macrosTab`, `info`, `settings`.
  `aria-labelledby` beats the perfectly good `title` sitting right there. Drop
  the reference, name from `title`, `aria-hidden` the `<a>`.
- **The visible tab set is not fixed.** Two of the eight carry an inline
  `display` style and Roll20 shows/hides them by campaign and role, so an index
  must be resolved against the tabs on screen *at the moment the key is pressed*.
- jQuery UI rewrites the nav's classes and tabindexes on every switch, so the
  naming is an idempotent `repair()` sweep, not a one-shot or an observer.

### The text chat

| Thing | Where |
|---|---|
| The log | `#textchat > .content` — **already `aria-live="polite"`, Roll20's own** |
| A message | `#textchat .content > .message`, `data-messageid` (null for `system`/`news`) |
| Sender | `.by` (`"Punnaphoj:"`) |
| General body | a **bare text node** directly under `.message` |
| Sheet roll | `.sheetroll > rolltemplate.dnd-2024` — identical to the Roll Log's |
| Dice roll | `.message.rollresult` → `.formula`, `.dicegrouping .diceroll .dicon .didroll`, `.rolled` |
| Input | `#textchat-input textarea`, `#chatSendBtn`, `#speakingas` |

Traps, all of which produced a wrong reading:

- **`.by` is only on the first message of a run.** Roll20 groups consecutive
  messages from one speaker and omits the sender from the rest, so a message
  inherits it by walking back to the nearest earlier `.message` that has one.
- **`.backing` is noise.** A `.diceroll` is a `.didroll` (the value) beside a
  `.backing` (a glyph from `dicefontd20`, empty text that still reads as a
  number). Read `.didroll`, never `.backing` — those were the stray `0`s.
- **`textContent` welds block elements together.** Roll20's "Chat Tips" notice
  came out as "Chat TipsType these chat commands". Append a space to every
  element in the clone before reading it.
- **Speaking as your own character duplicates the name.** `.by` and the
  template's `.meta__character-name` are then the same string —
  "Brother Lorian, Brother Lorian". Dedupe.
- **Roll20's live region must be switched off, not raced.** Setting each message
  up as one line and letting Roll20's `aria-live` announce it is timing-dependent
  and the raw version usually wins. `aria-live="off"` on `.content`, announce
  from ours once the line exists.
- **Chat history is replayed into the log at startup, and you cannot time it.**
  Roll20 streams the backlog over its socket, and on anything but a fast
  connection it lands well after any fixed delay from script load. A 2.5 s timer
  was tried and it replayed a crit fanfare for every historic roll on refresh.
  Gate on the log going **quiet** instead — every message seen while priming
  pushes the deadline back — with a hard ceiling so a busy table still goes live.
- **Anything gated on "is this message new" must be gated in one place.** The
  same bug had a second half: the bulk-arrival guard sat in the flush, but
  sounds were requested per message before it, so a burst that was correctly
  *not read* still played every sound in it. The sound now travels in the queue
  beside the line so one guard covers both.
- **If a message cannot be read, do not collapse it.** Collapsing hides
  everything and puts nothing back; leaving it raw is strictly better.
- **A sheet roll is added to the log twice.** Verified on the live VTT: press a
  roll button on an open character sheet and the same node arrives twice, ~260 ms
  apart, carrying the *same* `data-messageid`; only one survives in the log.
  Roll20's own new-message sound rings twice too, so this is Roll20 handling the
  message twice and is not fixable from here — only refusable. `markOnce` does
  not catch it (the two additions are two different nodes), and 260 ms is wider
  than the 150 ms burst window, so it became two separate announcements. Dedupe
  on `data-messageid`, not on the element.
- **Two things in the log are not chat.** An empty `.message.news` banner and a
  static `.message.system` "Chat Tips" block, both parked at the *end* of
  `.content`, so "go to the end of the chat" landed on the tips block every
  time. Neither has a `data-messageid` and all 40 real messages in the test
  campaign do, so `[data-messageid]` is what separates conversation from
  furniture. Furniture is still collapsed, but never navigated to or announced.

### Roll20's chat beep

Roll20 announces every new chat message with
`https://app.roll20.net/images/sounds/beep.ogg`. Two facts about how, both
measured on the live page, and both load-bearing:

- It is played through an `<audio>` element that is **never inserted into the
  document** (`new Audio(url).play()`, `isConnected: false`). There is no node
  to find and mute, and an isolated-world script cannot patch
  `HTMLMediaElement.prototype` because it has its own copy of it. Hence
  `page/suppress-roll-beep.js` and `"world": "MAIN"` — there is no other route.
- **Roll20 inserts the message before playing the beep** — same millisecond, and
  the log's last message is already the new one on entry to `play()`. So the
  newest message is the one being announced and the shim can simply look at it.
  If that order ever reverses the shim reads the previous message and leaves the
  beep alone, which is the un-shimmed behaviour, so it fails safe.

A roll is identified from Roll20's own markup — `.rollresult`, a `rolltemplate`
descendant, or `.inlinerollresult` — never by searching the text for an "XdY"
pattern, because a message someone typed by hand can contain "2d6" and is not a
roll. Checked against the test campaign's log: 55 messages, 47 rolls, 8 plain,
no disagreement with ground truth.

### Our own roll sounds

With Roll20's beep suppressed for rolls, `features/vtt-chat.js` decides what a
roll sounds like. Three rules, first match wins:

| Case | Sound |
|---|---|
| The d20 came up 20 or 1 | `natural-20.mp3` / `natural-1.mp3`, **whoever rolled it** |
| Your own roll | nothing |
| Anyone else's roll | `other-roll.mp3` |

**`.you` is how Roll20 marks your own messages** — it is on every message you
sent and on none that you did not. Verified in the test campaign, where the GM's
messages carry `player--<id>` and never `you`. That class, not the sender name,
is the test: the name changes with `#speakingas` and is missing entirely from
grouped messages.

Plus one sound that is **not** driven by the chat log at all: `roll.mp3` fires
when a `/roll`, `/r`, or a `%{name|attribute}` macro shorthand is sent from the
chat box, on the **press** rather than on the message coming back, so it
confirms the roll went. The macro form is what the roll shortcuts (below) send,
so they get the same press confirmation. Both send routes are watched — Enter in
`#textchat-input textarea`, and a click on `#chatSendBtn` — in the **capture**
phase, because Roll20 clears the textarea while handling the send and the value
is gone by the time a bubbling listener runs. `alt+shift+C` needs no case of its
own: it sends by clicking that button. The two listeners can both fire for one
send, hence the 500 ms guard. `/gmroll` deliberately does not count; only
`/roll`, `/r`, and the macro form were asked for.

The crit check reads the **d20's own face**, never the total, via
`rollFormat.critKindFromTemplate` for a sheet roll and `rollFormat.judge` over
`.didroll` for a `/roll`. Both are the same functions `last-result.js` uses.

The request sits **inside the message-id dedupe and after the priming gate**, so
Roll20 handling a sheet roll twice does not play the fanfare twice, and
reloading a campaign does not replay a sound for every roll in its history.
Playback is a serial queue capped at three, because a flurry of rolls should not
become ten seconds of audio.

Chrome's autoplay policy blocks this until the user has interacted with the page
at least once; `play()` rejects and the message is still announced. Note also
that the **sheet frame still plays `roll.mp3` on the press** of a sheet roll
button (`last-result.js`), which is a separate mechanism and is why "your own
rolls are silent" is not literally silent.

## The battle grid ("Map grid")

A screen-reader-only `<table>` built at the end of the VTT document that mirrors
the page's grid: one row per grid row, one cell per column, each token placed in
the cell it occupies, spoken with its name, facing, and — for player-controlled
characters — hit points. Reached by table navigation or the "Map grid" heading;
it is visually hidden. Each cell carries its own coordinate (there are no row
or column headers), so an empty cell reads "blank, A1" and an occupied one
"Brother Lorian — 12 hit points, facing west, F4". Column letters are uppercase,
row numbers start at 1 from the top.

The cells are also focusable: `alt+M` focuses the cell holding the current
player's token, and the arrow keys then walk the grid cell by cell (a roving
tabindex keeps one cell in the Tab order at a time, so Tab re-enters where the
user left). Focusing a cell reads it, because its text already holds the
coordinate, token and terrain; pressing `alt+M` when the cell is already focused
re-announces that text instead of doing nothing.

Unlike everything else in this extension, this is driven by Roll20's **model**,
not its DOM: the tabletop renders to an opaque WebGL canvas with zero DOM, but
`Campaign` (page world) exposes the whole page and token model. That forces the
two-file split:

- `page/tabletop-bridge.js` (`world: MAIN`) owns the `Campaign` subscription and
  forwards three verbs over `window.postMessage` — `r20a11yGridInit` (geometry +
  all tokens), `r20a11yGridDelta` (one token's new state), `r20a11yGridRemoved`.
  All presentation stays out of it.
- `features/map-grid.js` (isolated world) builds the table, keeps it in step,
  synthesises a change tone and announces through `Roll20A11y.announce()`.

Facts that shaped the design, each verified live against campaign 21893368:

- **HP is not on the token.** The new advanced sheet stores a character's whole
  state in an attribute literally named `store`; hit points are at the `store`
  model's `current.hitpoints.currentHP`. There is **no stored maximum** (the
  sheet computes it from hit dice), so only current and temporary HP are read.
  Read it via `character.attribs.models` — `attribs.each()` over a not-yet-loaded
  store iterates nothing, which looks exactly like a broken selector.
- **Backbone here is 0.9.2.** Collections have no `listenTo`; `set` fires
  `change`/`change:attr` only on a *real* change (equality-checked), so writing
  the same value back is a silent no-op — an event test can look dead when the
  mechanism is fine.
- **The map background is a graphic on the `map` layer**, and the only reliable
  way to tell it from furniture on that layer is that its `imgsrc` shares the
  file id with the page's `thumbnail`
  (`…/tKH66NDLvof2Axn_Sc2Efg/max.jpg` vs `…/thumb.jpg`). `layer` alone is not
  enough, and its size is not the full page.
- **"Player-controlled"** = the represented character's `controlledby` is
  non-empty; HP is shown only then, so the GM's secret monsters do not leak hit
  points.
- **Facing** is the token's `rotation` (degrees counter-clockwise, 0 = north,
  90 = west), rounded to the nearest of 8 compass points. (5e has no facing
  rules and the vision cone is the "real" facing — `rotation` is the pragmatic
  answer.)
- **A drag is many events.** `change:left`/`change:top`/`change:lastmove` fire
  repeatedly; the bridge tracks only the attributes that matter, coalesces to one
  message per token per tick, and the feature debounces sound + announcement
  ~150 ms so a move is spoken once. Selection is never forwarded.
- **Only real changes are announced, directionally.** Opening a character sheet
  loads its `store` attribute, which fires `store.on("change")` in the bridge and
  re-emits every token that represents that character (so the grid's HP stays in
  step). The feature diffs the incoming token against its previous state and
  announces only what actually changed: a cell move, placement or removal; a
  hit-point change (`took damage:` / `healed:`, player-controlled tokens only,
  and both sides non-null so the initial null → value store load is silent); a
  facing change (`turned to face X`, every token); a condition gained or ended
  (`is blinded` / `is no longer prone`); or a rename (`X renamed to Y`). Store
  writes that change none of these rewrite the cell silently.
- **Conditions live in the `store`, not on the token.** Like hit points, they
  are read from `store.current`, at `integrants.integrants.<id>` where each
  "Condition"-typed integrant carries `_active` and `name`. The bridge forwards
  a sorted array of active condition names (`conditionsOf`, null until the store
  loads), the grid appends them to the cell text ("… facing west, blinded,
  prone, F4"), and `attributeChanges` announces gains/losses only once both
  sides are non-null, so the initial load stays silent.
- **"Mine" (alt+M) is the token's `controlledby` naming the current player.**
  `window.currentPlayer` (page world) gives the player id; the bridge flags a
  token `mine` when its own `controlledby` or its represented character's
  contains that id (`"all"` does not count). A player can control *several*
  characters — in the test campaign `Punnaphoj` controls both — so alt+M focuses
  the first by grid order and says how many there are when more than one. It is
  loaded in the sheet frame too, where it only forwards the key, so it works
  from either frame.
- **A token larger than one square fills every cell it covers.** `width`/`height`
  are pixel footprints, so a Large (2×2) or Huge (3×3) creature spans
  `round(width/snapTo)` columns and rows; the grid writes it into each covered
  cell (`cellsOf`), `alt+M` and grid-order sorting still use the top-left cell,
  and Relative position measures distance to the nearest covered cell but points
  the o'clock bearing at the footprint's centre.

### Terrain identification ("Identify terrain")

`features/terrain.js` labels each cell with a short terrain phrase so an empty
cell reads "sand, A1" instead of "blank, A1", and a token cell reads
"… facing west, on wooden deck, F4". It is a separate feature file but writes
into `map-grid.js`'s cells, so it exposes a tiny hook on
`Roll20A11y.terrain = { bind(section, reRender, getBackground, getGrid), labelAt(col, row), reset() }`;
`map-grid.js` binds it once when its section is first built and consults
`labelAt` in `writeCell`/`tokenText`.

The button is screen-reader-only, inside the map-grid section above the table,
pressed on demand. On press it fetches the background image, resamples it onto
the grid, and sends it to Gemini with **structured output**
(`response_mime_type: application/json` + `response_schema` describing a fixed
R×C array of strings).

Facts that shaped it:

- **The background image is CORS-clean and scaled.** `fetch` on its `imgsrc`
  returns `access-control-allow-origin: *`, and its natural size differs from its
  world footprint (measured 1249×2048 placed at 1068×1750) — so it must be drawn
  at its `left/top/width/height` placement into a page-size canvas, not assumed
  1:1. `left`/`top` are the centre, so top-left = centre − size/2.
- **Only whole cells are sent.** The covered region is `ceil`/`floor` of the
  image bounds over `snapTo`; partially covered cells are left `blank` (a JPEG
  would turn their transparent slivers black). The crop is downscaled to 32px
  per cell before sending.
- **The API key** is asked for once with `window.prompt` (top frame, so allowed),
  stored in `chrome.storage.local` (isolated-world-only, needs the `"storage"`
  permission in the manifest), and cleared when Google rejects it so the next
  press re-prompts. Nothing is cached: every press re-fetches, and a page switch
  calls `reset()`.
- **The model id** is a one-line constant, currently `gemini-3.5-flash-lite`
  (2.5 Flash-Lite is retired).

### Relative position

`features/relative-position.js` adds a screen-reader-only "Relative position"
section directly after the battle-grid table, answering what the grid itself
does not: *how far, and in which direction, is everything else from me?* It
measures from the current player's token (the same "first by grid order" rule as
alt+M) and lists every other creature token — objects layer only, no furniture
— as a distance plus an o'clock bearing taken relative to the reference token's
facing: 12 o'clock is straight ahead, 3 to the right, 6 behind, 9 to the left.

It consumes the bridge's three postMessage verbs independently of `map-grid.js`
and never writes into the grid's cells, so it has no `bind()` hook as terrain
does — it keeps its own token map. The section is always live (rebuilt silently
on every delta) and reached by its heading, never announced on change.

Distance uses Roll20's own measurement: grid squares per the page's
`diagonaltype` ("foure" = diagonals cost one square), times `scale_number`,
labelled with `scale_units`. Facing is rounded to the same 8 compass points the
grid shows, and the o'clock is computed against that *rounded* facing so the
announced direction and bearing always agree.

## Keyboard shortcuts

There is no `commands` block in the manifest; these are page-level `keydown`
listeners in capture phase. A shortcut must be registered in **both** frames —
the key goes to whichever frame has focus, and focus is usually, but not
always, in the sheet. Matched on `event.code`, so a non-US layout still works.

| Key | Does | Page |
|---|---|---|
| `alt+O` | Re-read the "Last Result" box / the chat message at the cursor | both |
| `alt+A` / `alt+S` / `alt+Z` | Advantage / Normal / Disadvantage | both |
| `alt+1` … `alt+7` | Send `/r 1d4`, `1d6`, `1d8`, `1d10`, `1d12`, `1d20`, `1d100` | VTT |
| `alt+shift+1` … `alt+shift+9` | Focus the *n*th visible sidebar tab's panel | VTT |
| `alt+[` / `alt+]` | Previous / next chat message | VTT |
| `alt+shift+[` / `alt+shift+]` | First / last chat message | VTT |
| `alt+shift+C` | Prompt for a line and send it to chat | VTT |
| `alt+shift+S` | Open the skill-roll dropdown | VTT |
| `alt+shift+A` | Open the ability-roll dropdown (checks and saves) | VTT |
| `alt+shift+I` | Roll initiative directly | VTT |
| `alt+shift+D` | Roll a death save directly | VTT |
| `alt+shift+H` | Speak the character's HP and AC | VTT |
| `alt+shift+T` | Speak the character's remaining spell slots | VTT |
| `alt+W` / `alt+shift+W` | Open the attack-roll / attack-damage dropdown | VTT |
| `alt+shift+E` | Open the character sheet, beep when it has loaded | VTT |
| `alt+shift+R` | Prompt for a dice formula and roll it with `/r` | VTT |
| `alt+shift+-` | Toggle token movement/change announcements (default off) | VTT |
| `alt+shift+=` | Toggle the readout of others' chat and rolls (default on) | VTT |
| `alt+M` | Focus the grid cell holding the current player's token | VTT |

`alt+S` selects Roll20's control labelled **"Automatic"** but is spoken as
**"Normal"**.

The four chat-navigation keys and `alt+O` **never move focus** — they only
speak. `alt+shift+<n>` and `alt+M` are the ones that do, deliberately.

`alt+[` at the first message and `alt+]` at the last also sound a short tone —
440 Hz for the start of the log, 660 Hz for the end — synthesised with a Web
Audio oscillator rather than shipped as a file, because the repo's existing
sounds are roll flourishes and far too long to mark a boundary. The tone plays
in **whichever frame the key was pressed**, so there is always a real user
gesture behind it; the context is primed on the keydown, because the reply that
actually triggers the tone arrives as a `postMessage`, which is not a gesture.
Every `say` callback passed to `move()` therefore takes `(text, edge)`, and the
sheet-bound one forwards both halves as `r20a11yChatResult` /
`r20a11yChatEdge`.

`alt+shift+C` raises a native `window.prompt()`, and it is raised in the **top
frame even when the key was pressed in the sheet**, because Chrome blocks
`prompt()` inside a cross-origin iframe outright — a blocked one returns `null`
with nothing shown. Focus is then restored in two stages: the top frame puts it
back on the `<iframe>` element, and the sheet frame puts it back on the control
inside. Neither alone is enough.

**A native prompt blocks the renderer, so `alt+shift+C` cannot be tested with
`javascript_tool` — the call hangs.** It has to be tried by hand.

**The digits are split by shift and nothing else.** `alt+<n>` rolls a die
(`vtt-chat.js`) and `alt+shift+<n>` opens a sidebar tab
(`vtt-sidebar-tabs.js`); the first insists on `!event.shiftKey` and the second
on `event.shiftKey`, so they cannot both fire. If either ever drops its check,
one keypress runs both handlers.

The dice shortcuts announce nothing on success: the roll sound fires on the
press and the result is announced when it arrives, so a "Sent." between them
would be three notifications for one key. Failures are still spoken. That is
why `sendText` takes its success message as an argument and why the "" reply is
still posted to the sheet frame — that reply is the sheet's cue to take focus
back after a prompt grabbed it; the die and send keys never move focus (see
"Focus suppression" under Critical invariants), so for them it is a no-op.

### Roll shortcuts (`alt+shift+S` / `A` / `I` / `D` / `H`)

`features/roll-shortcuts.js`. Skill and ability open a `<dialog>` holding an ARIA
listbox — S lists the 18 skills, A the 12 ability checks and saves — and choosing
an option sends Roll20's macro form `%{Character Name|attribute}`. Initiative,
death save, and state have no dropdown and send straight away:

- `alt+shift+S` → `%{Name|acrobatics}`, … `%{Name|survival}`
- `alt+shift+A` → `%{Name|strength}`, … `%{Name|charisma_save}`
- `alt+shift+I` → `%{Name|initiative}`
- `alt+shift+D` → `%{Name|death_save}`

`alt+shift+H` (HP and AC) and `alt+shift+T` (spell slots) **send nothing**. They
read the character model through `Roll20A11y.requestCharacter` and speak the
answer — see "Reading the character" below.

The character is the current player's first controlled character, by name, read
from the VTT's "Speak As" dropdown (`#speakingas`) — the options Roll20 already
keeps sorted, so the first `character|…` option is the one to roll as.
`currentCharacterName()` lives in `lib/core.js` so every shortcut that rolls
agrees on who it is rolling as; two copies of it could drift apart.

The modal itself is `lib/choice-modal.js`, shared with the attack shortcuts
below.

`features/speaking-as.js` (VTT top frame) sets `#speakingas` to that same first
character on load, so chat is sent in-character instead of under the account
name. It is a plain native `<select>` bound with a jQuery `change` handler, so
the set is `sel.value = …` plus a `dispatchEvent(new Event("change",
{bubbles:true}))`. The options arrive in two stages — the account option first,
then the controlled characters — so the sweep keeps polling for the
`character|…` option rather than settling for the account name. It also calls
`markReady("speaking")` once the dropdown holds any option: readiness ("Table
ready.") now requires chat + grid + speaking-as.

The modal is a native `<dialog>.showModal()` (so aria-modal, inert background,
and focus restore are the platform's), with the options as an ARIA listbox — not
a `<select>`, which auto-commits on the first Down arrow and whose `showPicker()`
popup a screen reader cannot read. Escape closes in one press via a
document-level capture keydown (the native `cancel` stays as fallback). The key
is registered in both frames like every shortcut: the sheet frame forwards it,
the top frame acts, and focus is handed back down once the dialog closes or the
roll is sent.

### Attack shortcuts (`alt+W` / `alt+shift+W`)

`features/attack-shortcuts.js`. Both keys open the same modal over the
character's attacks, named with what they will roll, and send the chosen row's
repeating-section macro:

```
%{Name|repeating_attack_$N_attack}       alt+W         the attack roll
%{Name|repeating_attack_$N_attack_dmg}   alt+shift+W   its damage
```

```
Sacred Flame - DEX 13                        Sacred Flame - damage 1d8
True Strike Bonus Damage                     True Strike Bonus Damage - damage 0 Radiant
Longsword (One-Handed) - attack roll +5      Longsword (One-Handed) - damage 1d8+3
Throw Holy Water - DEX 11                    Throw Holy Water - damage 2d8 Radiant
Longsword (Two-Handed) - attack roll +3      Longsword (Two-Handed) - damage 1d10+1 Slashing
Unarmed Strike - attack roll +3              Unarmed Strike - damage 2 Bludgeoning
```

Unlike every other shortcut, the contents come from Roll20's **model**, not its
DOM: `page/character-bridge.js` (page world) reads the character's `store`
attribute out of `Campaign.characters` and posts the raw integrants over;
`lib/character-rolls.js` (isolated world) derives the labels. The round trip is
`Roll20A11y.requestCharacter(name)` in `lib/character-data.js`, shared with the
HP and spell-slot readouts. That split is the
same one the battle grid uses, and for the same reason — see
`roll20-character-model.md` for the model itself. No sheet needs to be open:
`Campaign.characters` and `store` are populated at game join.

Facts established live in campaign 21893368, each of which shaped the design:

- **`$N` is the position among the Attack integrants**, in
  `Object.values(store.integrants.integrants)` order —
  `repeating_attack_$0_attack` rolled Sacred Flame and `$2` rolled the
  one-handed Longsword, matching that order exactly. So the list is built
  **unfiltered and unsorted**: dropping or reordering one row silently rolls the
  wrong attack. The bridge posts an **array**, not the object it came from, so
  the order cannot be lost in transit.
- **Only two action names work.** `_damage`, `_dmg`, `_roll` and `_crit` are all
  answered with *"…is not a supported action"*. Damage is `_attack_dmg`.
- **An attack with no attack roll is still rollable.** "True Strike Bonus
  Damage" has `attack: null`, and `$1_attack` returns its damage card rather
  than erroring, so no index in the list is a dead end and none needs hiding.
- **The chat card's Damage button is not a macro.** It is
  `data-sheet-action="damage"` with
  `data-args="normal:I|<attackId>:I|<damageId>"`, dispatched through
  `characterSheet.state.allRelays["1"].methods.performAction`. That is a second,
  entirely separate route to the same roll; the macro form is used here because
  it goes through the ordinary chat send and needs no relay.
- `characterSheet.availableRolls` / `availableActions` / `tokenActions` stay
  **empty** on an advanced sheet, and `relay.methods.getCharacterMacros` returns
  `{macros:{}}`. Neither is a route to the macro list; the only way to learn an
  action name is to send it and read the error.

The arithmetic, all validated against `test.json` and confirmed by the live
rolls above (`Wisdom +3, Proficiency +2` for the `+5`; `1d8+3` for the damage):

| Quantity | Rule |
|---|---|
| Ability score | `Ability Score` integrants: **two passes** — `Set Base` assigns, then `Modify` adds. One pass is order-dependent and the store interleaves them (a background `Modify` for Wisdom sits *before* the point-buy `Set Base` that would wipe it). |
| Proficiency bonus | `2 + floor((maxTotalLevel − 1) / 4)` over the `Class Level` integrants |
| Attack roll | `mod(attack.abilityBonus) + PB + attack.bonus`, for `attack.type` of `Melee`/`Ranged` only |
| Save DC | `save.saveFormula` when present (`flatValue` + ability × multiplier + PB), otherwise `8 + PB + mod(spellcasting ability)`, walking `attack.parentID → Spell → parentID → Spellcasting` |
| Save label | abbreviates **`save.saveAbility`** — the ability the *target* rolls, not the one that set the DC. That is why Sacred Flame reads "DEX 13" off a Wisdom caster. |
| Damage | first `Damage` child: `_diceCount`d`diceSize` `+ _bonus + abilityMod`, where `ability` is `"auto"` (the attack's own ability), `"none"`, or a named one. No dice → the flat total alone, which is how Unarmed Strike reads "2". `damageType` appended when non-empty. |

**Proficiency is looked up, not assumed.** `attack.proficiencyLevel` wins when
it is there (Unarmed Strike states "Proficient" outright). Otherwise the weapon
comes from the attack's `parentID` — a weapon attack hangs off its Item — and
the Item's **`weaponData`** carries both the tier and the weapon's own name:

```jsonc
"weaponData": { "category": "Melee", "training": "Martial", "type": "Longsword" }
```

Either half can be what a `category: "Weapon"` `Proficiency` integrant names
(`proficiency: "Simple"` / `"Martial"` from a class, a specific weapon from a
species), so both are matched and the best `proficiencyLevel` wins — Expertise
doubles PB, "Half Proficient" halves it, "Not Proficient" drops it.

The one remaining default: an attack whose weapon cannot be resolved at all —
a spell attack, or a custom one with no Item behind it — counts as proficient,
which is what those are in practice. A weapon that *is* resolved and matches
nothing is **not** proficient.

`equipData` is a red herring here (it holds only `{equippable, equipped}`) and
the `Damage` integrant carries no proficiency information at all — the fields
are `_diceCount`, `diceSize`, `_bonus`, `ability`, `damageType`, `overrideCrit`,
`critDiceSize`. Damage never includes PB in the first place.

`lib/character-rolls.js` takes a plain list and returns plain data, so it can be
exercised **offline against `test.json`** — which holds a real page-world
snapshot of the reference character, store included — with no browser and no
reload cycle. Do that before every hand-test; it is the only automated coverage
in the repo.

### Focus and the dialogs

A dialog takes focus, and giving it back announces whatever receives it — over
the top of the roll the dialog just fired. Two mechanisms in `lib/core.js`,
`parkFocus()` and `deferUntilQuiet()`, and both matter.

**The dialog opens in the frame that pressed the key.** `lib/remote-modal.js`:
the top frame decides what is in the list and posts it down, the sheet frame
opens the dialog and posts the choice back, and the top frame sends the macro.
Focus never crosses the iframe boundary.

That is not a nicety. Opening it in the top frame while the user was in the
sheet cost this, every time, and none of it is suppressible — it is simply what
leaving and re-entering a document costs:

```
out of table  out of frame  same page link  Skip to the chat tab  blank
…
Character sheet for Tempis  frame  Ability scores  table with 7 rows and 5 columns  Roll…
```

("Skip to the chat tab" is Roll20's own link, not ours. The re-orientation
appears to be NVDA rebuilding its virtual buffer in the top document once the
`aria-modal` dialog closes and the rest of the page becomes visible to it
again.)

Because the result still arrives in the **top** frame's chat log, it is
**routed** down rather than announced there — `routeAnnouncementsTo(frame)` in
`lib/core.js`, consumed by `vtt-chat.js`'s flush. Routed, not echoed: while a
route is set the top frame does not announce at all, or the line would be spoken
twice. One line clears the route, with a 5 s ceiling. The same routing covers
`alt+shift+I` and `alt+shift+D`, which send straight to chat.

**Focus goes back at once, and the speech that follows is cut off.** Closing the
dialog hands focus to the control that opened it — and a screen reader answers
by reading the control *plus* everything it sits inside:

```
Ability scores  table with 7 rows and 5 columns  Roll Strength +1 saving throw  button
```

What carries the result over that chatter is being announced **assertively** —
`claimNextAnnouncement(frame)` marks the next chat line as the answer to what
the user just pressed, and `vtt-chat.js`'s flush hands it to `deliverClaimed()`
instead of announcing it. Delivered, not echoed: routed to the sheet frame when
the key came from there, spoken here when it did not, assertive either way, and
never both or it would be said twice. One line clears the claim, with a 5 s
ceiling. `alt+shift+I` and `alt+shift+D` claim too.

**The chatter itself is still unsolved.** See below.

### What was tried and did not work

Each of these cost a reload cycle; none of them is worth trying again.

- **Parking focus on a hidden element before `showModal()`**, so the dialog's
  restore lands somewhere silent. It works — but the park is outside the ARIA
  table, so a screen reader announced "out of table", then hunted for context
  and read a neighbouring control ("radio button, not checked, Whisper"), then
  "blank". Moving focus *anywhere* costs an announcement; the only question is
  whose.
- **Giving the park an `aria-label` of a no-break space**, on the theory that a
  screen reader reads surrounding content to compensate for a missing name. No
  effect — "Whisper" was still announced.
- **Deferring the hand-back** until the result had plausibly been spoken. Also
  works, and the result did come through clean, but focus sits in limbo for a
  second or two and the pre-roll chatter is unchanged. Superseded by cutting the
  speech instead.
- **Pulsing an assertive live region to cut the speech off.** The idea is
  sound — assertive interrupts — and it was tried at 80 ms, 300 ms and a full
  second of pulses, with a no-break space and then with commas as the filler.
  None of it made any difference. The conclusion to carry forward: **an
  assertive live region does not interrupt a *focus* announcement.** It
  interrupts other live regions. Focus speech appears to be a separate channel
  the page cannot reach, so no amount of widening or changing the filler will
  help, and this should not be tried again.
- **`autofocus` on the first option** removed a stray "selected" from the dialog
  opening but did **not** stop the dialog being announced twice. That duplicate
  may simply be how NVDA reports entering a modal (the dialog, then the focused
  item in context) rather than two focus events. Unresolved.

### Reading the character (`alt+shift+H` / `alt+shift+T`)

Both speak, and neither sends:

```
HP 12 out of 12, with 0 temp HP, AC is at 18.
Spell slots. Level 1: 2 of 2. Level 3: 1 of 3.
```

`alt+shift+H` used to whisper itself the numbers with
`/w "Name" HP @{Name|hp} out of @{Name|hp|max} …`. That needed the sheet worker
running to resolve the macros, put a line in the log on every press, and told
the rest of the table it had happened. Reading the model has none of those costs
and works with the sheet shut.

- **HP and AC come from `custom_meta1`**, a character *attribute* (not a store
  key) holding Roll20's own computed summary:
  `{ hp: { current, max, temp }, ac: { total }, currency: [...] }`. This is the
  one place maximum HP exists — the store has hit dice and a pile of `Hit Points`
  "Modify" bonuses, never the total — so it is read from here, with
  `store.hitpoints` as the fallback for current and temporary HP. Max has no
  fallback; the sentence just omits it.
- **Spell slots need both halves from different places.** How many are *left* is
  `store.spellSlots.currentByLevel`, keyed `CANTRIP`/`FIRST`/…/`NINTH`. Totals
  are not stored at all — the sheet computes them, two ways, both transcribed
  from the bundle:
  1. the character's own `Spell Slot` integrants (`spellLevel`, `calculation` of
     `"Set Base"` or `"Modify"`, `valueFormula.flatValue`), which is what the
     sheet uses for a single spellcasting class;
  2. Roll20's slot table indexed by caster level, which it uses when the
     character multiclasses.

  We try (1) and fall back to (2) when it yields nothing, because a store whose
  `Spell Slot` integrants have not loaded would otherwise tell a Cleric they
  have no spell slots. **`test.json` is exactly that case** — it carries no
  `Spell Slot` integrants at all (it has dangling `childIDs` elsewhere too), so
  the offline test exercises the fallback, and the integrant path is covered
  with synthesised ones.
- **Levels with no slots are omitted**, which is also what the sheet does — its
  table lookup drops zero entries before returning.
- **Warlock pact slots** are a separate pool (`currentPactByLevel`) whose total
  this does not compute, so only what is left is spoken: "Pact magic: 2 at level
  3." Reporting them without a total beats dropping them silently.

Readouts are announced in **whichever frame the key was pressed**: `replyDone`
carries the line down to the sheet frame as `r20a11ySay`, the same way the chat
shortcuts hand their result back. Careful with it — `choiceModal`'s `onClose`
passes a *boolean*, so the modal path wires `onClose: () => replyDone()` rather
than passing the function straight in, or the dropdown would announce "true".

### Opening the sheet (`alt+shift+E`)

`features/open-sheet.js`. `alt+E` is not usable — it is Chrome's own accelerator
for the three-dot menu.

- **`char.view.showDialog("sheet")`, not `d20.engine.openCharacterForToken(id)`.**
  The latter is what `roll20-character-model.md` recommends and it was verified
  live to return without error and do **nothing at all**. Note also that
  `window.d20` is **undefined** on the VTT; it lives on
  `CharacterSheetsManagerSingleton.d20` and on each `character.d20`.
- **Already open → announce and stop.** Reopening restarts the sheet worker,
  which is what resolves `@{Name|hp}` for `alt+shift+H`, for no gain.
- **"Loaded" is the sheet frame's own account of itself.** It polls until its
  document has laid out and holds rendered controls, then posts up. The test is
  deliberately *not* tied to a Roll20 class name: those move between deploys and
  a wrong one means a beep that never comes.
- **The top frame also asks** (`r20a11ySheetReadyQuery`), because Roll20 reuses
  one iframe — reopening a closed sheet renders nothing new, so there is no
  spontaneous report to wait for. Same race-closing pattern as
  `r20a11yGridReady` in the tabletop bridge.
- The beep is a rising 784→1047 Hz pair, distinct from 440/660 (chat log
  boundaries), 880 (grid change) and 660→880 ("Table ready."). It plays in
  **whichever frame the key was pressed**, and the context is primed on the
  keydown, because the thing that finally triggers it is a `postMessage`.

## Test page

`https://app.roll20.net/characters/sheet/18539970?sheet_shortname=dnd2024byroll20`
(character "Brother Lorian"). The user has confirmed this is a **test
character**, so mutating it is fine.

For the VTT: campaign **21893368**, "DnD test win nut pond", launched from
`https://app.roll20.net/editor/setcampaign/21893368`. Confirmed a **test room**,
so chatting and rolling in it is fine. Its log already holds several dozen real
messages of every shape — sheet rolls at normal/advantage/disadvantage, `/roll`
dice, plain chat in Thai, a typo'd formula (`1dep`), system notices — which
makes it a good corpus to run a formatter over without sending anything.

Opening the campaign puts a **second session on the same game**, which can
disconnect the user's own tab. Say so before doing it. Also note the automation
tooling can only drive tabs in its own tab group, so "use the tab I already have
open" is not actually possible — a fresh one has to be launched. Still say what test data you left behind —
removing a proficiency or language is not currently possible from the sheet UI
by any route we have found, so anything added there stays.

Rolling is cheap and safe: it only appends to the roll log, which is
server-backed and shared across tabs, so a roll made in one tab shows up in
another. That makes the log a good read-only source of real examples — running
extraction logic over the accumulated history in `javascript_tool` checks it
against dozens of real entries without rolling anything.

Note that clicks dispatched into the sheet iframe by the `computer` tool are
unreliable when the automated tab is backgrounded (`document.hidden === true`):
the first roll after a page load usually fires and later ones often do not.
Do not read that as the feature being broken.

Never simulate a **real mouse drag** (`computer` tool `left_click_drag`) on the
sheet: a drag that ends over an input has corrupted character stats (HP) before.
Dispatch DOM events at specific elements instead — that is what the extension
does and it cannot touch unrelated fields.

## Critical invariants

Roll20's page is Vue-based. These caused real, hard-to-diagnose bugs:

- **Render is asynchronous.** Never `querySelector` for an app-rendered element
  on the same tick as the event that creates it — it will be `null`. Use
  `Roll20A11y.waitForElement()`.
- **Poll with `setTimeout`, never `requestAnimationFrame`.** rAF is fully
  paused while a tab is backgrounded, so an rAF poll hangs forever instead of
  timing out. Applies to `announce()` too.
- **Always fire `dragend`, including on failure paths.** It clears
  `isPageBeingDragged`; leaving it set keeps a stale `.compendium-dropzone`
  mounted and breaks the next action.
- **`enhance()` fires only for *added* nodes.** It has no attribute or removal
  handling, so whatever `onMatch` does to a long-lived container happens exactly
  once. Vue re-renders panel internals freely — when it does, injected nodes in
  that subtree are destroyed, attributes we set on replaced elements are gone,
  and nothing puts them back. The symptom is a feature that works on first open
  and silently dies after the first interaction.
- **Do not try to predict which node Vue will replace.** Three attempts at a
  targeted fix for the proficiency picker all failed, each assuming a different
  node was the stable one. For injected UI that must survive re-renders, use a
  `setTimeout` sweep with an idempotent `repair()` — see `combobox-labels.js`.
  `repair()` must check before every write, so a pass with nothing to do
  performs no DOM mutations at all; a redundant write is something a screen
  reader can react to.
- **A feature's own `MutationObserver` must not observe its own writes.** An
  observer whose disclosure button lived inside the subtree it watched span
  forever and made the button appear dead. If an observer is genuinely needed,
  park injected UI outside the observed subtree and watch `childList` only,
  never `attributes`.
- **Chrome ignores `aria-hidden` on an element that contains focus.** Move
  focus away first, then hide — the reverse order silently does nothing.
- **Never write state we depend on onto a Vue-owned element.** A class added to
  Roll20's roll-log drawer survived exactly one roll: Vue rewrites `className`
  when it re-renders on open and close, so the second roll flashed the drawer
  open and stole focus again. Key CSS off `<html>` plus one of Roll20's own
  stable attributes (`data-testid`) instead, so nothing has to survive
  anywhere. The first-time-works-then-dies shape is the tell.
- **Roll20 mounts *two* sheet iframes, and one of them is `0x0`.** Both run
  every sheet content script, and the ghost contains a full duplicate of the
  markup — so a feature that acts on what it finds will act twice, once
  invisibly. A frame whose `document.body` has no size is the ghost and should
  install nothing; the top frame must likewise post to the iframe that has a
  size, not the first one it finds. This is the "panels can be duplicated" trap
  one level up.
- **`announce()` has two failure modes, both silent.** The live region must be
  in the document *before* it is written to — one created and filled in the same
  moment is not yet registered, and its first message is simply never spoken, so
  `lib/core.js` builds it at load. And Chrome batches accessibility updates, so
  clearing the region and putting the **same** string back within one frame nets
  out to no change: a repeated message goes unspoken while a different one is
  fine. Alternate calls therefore get a trailing ` `, which is not voiced.
  Symptom: a shortcut that is silent when pressed twice but speaks the moment
  you press a different one.
- **There is not one `input[type="radio"]` on the sheet.** The radios are
  Headless UI divs — `[role="radio"]` with `aria-checked`, grouped under
  `[role="radiogroup"]` — and the group carries the current value in
  `data-selectedvalue`, which is what to read rather than inferring it. Roll
  mode is `.manage__roll-mode--radio`; `.manage__roll-privacy--radio` is a
  near-identical sibling group holding Public/Whisper, so never match
  `.poly-radio__button` unscoped.
- **Headless UI focuses a radio option when you `click()` it.** `click()` does
  not move focus on its own, but its handler does, as part of roving tabindex.
  Capturing focus and putting it back is not enough: the return re-announces
  wherever the user was. The move is suppressed at the source instead — mark the
  option `data-r20a11y-no-focus` (the `NO_FOCUS_ATTR` constant), and
  `page/suppress-focus.js` makes `HTMLElement.prototype.focus` a no-op for a
  marked element; the isolated world cannot patch that prototype (its own copy).
  Clear the marker in the same callback that confirms the value took. Do not
  strip the option's `tabindex` to prevent it — that is the same attribute
  Headless UI uses for arrow-key navigation within the group. `dialog.showModal()`
  and `window.prompt()` focus by other, native paths this shim does not and
  should not intercept.
- **The sheet is a cross-origin iframe**
  (`https://advanced-sheets.production.roll20preflight.net`). You cannot script
  into it, `contentDocument` is `null`, the a11y tree stops at the boundary, and
  `read_console_messages` cannot see content-script logs. The only channel out
  is the report bridge in `lib/core.js`: the frame `postMessage`s to the parent,
  which appends to a hidden `#r20a11y-report` node in the top document — read
  that node to see what the frame found.
- **SKILLS is a five-level CSS subgrid chain.** Column alignment survives only
  through an unbroken chain of grid boxes, so a real `<table>` anywhere in it
  destroys the layout. Every table on the sheet is therefore ARIA roles applied
  in place.
- **`aria-colindex` is not enough on a plain `role="table"`.** NVDA counts cells
  positionally, so a row missing an optional cell still shifts. Insert real
  filler cells for the absent columns.
- **Roll20's two number steppers.** The sheet ships `PolyIncrementer` *and*
  `UtilityIncrementer` — structurally identical, `poly-` vs `utility-`
  throughout — and uses both. Ability scores moved to the new one and every
  feature naming the old one stopped matching **silently**, because only
  `abilities-table.js` and `skills-table.js` report a failure at all. Both are
  still in the bundle, so this is an addition, not a rename. Match with
  `Roll20A11y.INCREMENTER` (`BOX` / `LABEL` / `INPUT` / `INCREASE` /
  `DECREASE`), which accepts either; four features depend on it
  (`abilities-table`, `control-labels`, `currency`, `inventory-table`). The two
  differ in one way that matters: Poly's caption is `<label role="label">`,
  which nullifies the element's own semantics and names nothing, while
  Utility's has no role, so its `for`/`id` pair works.
- **The ABILITIES panel is duplicated, like SKILLS.** Two
  `.inline-abilities-panel__ability-items` exist with the *same class*, one at
  0x0 and one visible, six rows each — so unlike SKILLS there is no class to
  scope by, only size. Any count taken from that panel is doubled.

## Conventions

- Features never query the DOM once at startup — Roll20 renders results long
  after load. Register with `Roll20A11y.enhance(selector, onMatch)` and keep
  `onMatch` idempotent via `markOnce`.
- Every user-visible action announces its outcome through
  `Roll20A11y.announce()`. Roll20's own toasts are not reliably announced.
- Prefix all injected classes and data attributes with `r20a11y-`.
- Fail safe and say so: if an expected element is missing, announce a plain
  failure message rather than throwing or silently doing nothing.
- This depends on undocumented Roll20 internals (`.compendium-page__upper`,
  `.compendium-dropzone`, the `page` dataTransfer key). When touching that
  logic, re-verify against the live bundle rather than trusting these notes.

## Re-inspecting Roll20's bundle

Two bundles, one per frame:

- top frame — `https://cdn.roll20.net/production/enhanced-character-vault/main.js`
  (~12 MB, minified)
- sheet frame — `https://cdn.roll20.net/advanced-sheets-production-<hash>/dnd2024byroll20/sheet.js`
  (the hash changes on each deploy; read it off a network request)

Fetch in the page and string-search. The browser tool blocks returning long raw
slices; replacing `=`, `;` and `?` before returning the string works around it
(`clean()` in `lib/core.js` does exactly this).

**Getting the sheet bundle's hash: use the probe's own heartbeat.**
`read_network_requests` does not surface the iframe's subresources (nothing for
`advanced-sheets`, `sheet.js` or `cdn.roll20.net`), and fetching the frame's
document URL to read the script tag out of it is a bare `TypeError: Failed to
fetch` — the preflight origin sends no CORS headers. Both were tried.

But the sheet frame knows its own `location`, and `debug()` can post it out. The
probe's heartbeat line already carries it:

```
heartbeat top:false body:1280x0 path:/https://storage.googleapis.com/roll20-cdn/advanced-sheets-production-9b1f7af9/dnd2024byroll20/dnd2024byroll20
```

With that hash the bundle is an ordinary `curl` away, from the shell, no browser
involved:

```bash
curl -sL https://cdn.roll20.net/advanced-sheets-production-<hash>/dnd2024byroll20/sheet.js -o sheet.js
grep -o '[a-z0-9-]*incrementer[a-z0-9_-]*' sheet.js | sort | uniq -c | sort -rn
```

That is how the two incrementer components were found, and how the exact button
modifiers (`increment` / `decrement`) were confirmed without another reload
cycle. Reach for it when the probe has told you *that* something is renamed and
you need to know what to, or what else moved with it. The probe still comes
first: it answers which selector broke, and it hands you the hash.
