# Roll20 Accessibility Helper — installing

An unofficial Chrome extension that makes Roll20's character sheet and its VTT
game session usable with a keyboard and a screen reader.

Nothing here needs to be compiled and nothing else needs installing — no .NET,
no build tools, no Visual C++ redistributable.

## 1. Put the folder somewhere permanent

Chrome loads an unpacked extension **from where it sits** and re-reads it at
every browser start. If this folder is moved or deleted later, the extension
stops working. Somewhere like `C:\Users\<you>\Roll20A11y\` is fine; the
Downloads folder is not.

## 2. Load it in Chrome

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked**, and pick this folder — the one holding `manifest.json`
4. Check the id it shows is `__EXTENSION_ID__`

Chrome will warn about developer-mode extensions each time it starts. That is
expected for an unpacked extension and is not a problem.

## 3. Install the screen-reader helper (Windows + NVDA only, optional)

**Skip this entirely on macOS or Linux, or if you do not use NVDA.** Everything
else works without it — see "On macOS and Linux" below.

In `native\`, right-click **install.ps1** → *Run with PowerShell*. If Windows
refuses, open PowerShell in that folder and run:

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

It prints what it did and finishes with a self-test. **Have NVDA running when
you run it**, so the test can confirm it can actually reach NVDA — it will say
so if it cannot.

To remove it later: `powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall`

### What it does and why it needs installing separately

Closing a dialog gives focus back to the control that opened it, and NVDA
answers by reading that control *and* everything it sits inside — over the top
of the roll you were waiting for. Nothing a web page can do gets in front of
that, so the extension asks NVDA to stop talking for a moment instead, through
NVDA's own controller API. A web page cannot call that; a small Windows program
can. That program is what this step installs.

It is registered as a Chrome "native messaging host", which is why it needs a
registry entry rather than just a file.

## On macOS and Linux

Steps 1 and 2 are all there is. The extension loads and every feature works;
step 3 is Windows-only and simply does not apply.

Nothing breaks or errors: the extension asks once, at page load, whether a
silencer is reachable, gets told no, and remembers that. Dialogs then close the
way they always did. The only difference is the one thing the helper exists to
fix — after a dialog closes, your screen reader reads the control that gets
focus and everything around it, and the roll result waits its turn behind that.
Noisier, never broken.

The same is true on Windows if you skip step 3, if NVDA is not running, or if
you use JAWS or Narrator instead. There is no half-working state: the helper is
either there and used, or absent and ignored.

## Using it

Open a Roll20 game. Press `alt+shift+H` to hear your character's HP and AC — if
that speaks, everything is working.

The keys, all of them:

| Key | Does |
|---|---|
| `alt+shift+S` / `A` | Skill roll / ability roll — pick from a list |
| `alt+W` / `alt+shift+W` | Attack roll / attack damage |
| `alt+shift+I` / `D` | Initiative / death save |
| `alt+shift+H` / `T` | Speak HP and AC / remaining spell slots |
| `alt+[` / `alt+]` | Previous / next chat message |
| `alt+M` | Jump to your token on the battle grid |
| `alt+shift+E` | Open the character sheet |
| `alt+shift+R` | Prompt for a dice formula and roll it |
| `alt+shift+C` | Prompt for a line and send it to chat |
| `alt+1` ... `alt+7` | Roll 1d4, 1d6, 1d8, 1d10, 1d12, 1d20, 1d100 |
| `alt+A` / `alt+S` / `alt+Z` | Advantage / normal / disadvantage |
| `alt+O` | Re-read the last result, or the chat message at the cursor |
| `alt+shift+[` / `alt+shift+]` | First / last chat message |
| `alt+shift+1` ... `alt+shift+9` | Focus the nth sidebar tab's panel |
| `alt+shift+-` | Toggle token movement announcements (off by default) |
| `alt+shift+=` | Toggle reading others' chat and rolls (on by default) |

`alt+S` picks Roll20's control labelled "Automatic" but is spoken as "Normal".

## If something is wrong

- **A shortcut does nothing** — make sure the Roll20 tab has focus, and that
  you reloaded the tab after installing.
- **Rolls are announced but the chatter is still there** — the NVDA helper in
  step 3 either was not installed or could not reach NVDA. Re-run `install.ps1`
  with NVDA running and read what it prints.
- **"Communicate with cooperating native applications"** in the permissions
  list — that is step 3's helper, and it is the only thing that uses it. The
  extension talks to one program, the one you installed, and nothing else.
- **Everything stopped after a Chrome update** — check `chrome://extensions`;
  Chrome sometimes turns developer-mode extensions off. Switch it back on.

## Licence and credits

Unofficial and not affiliated with Roll20 or NV Access.

`native\nvdaControllerClient.dll` is NVDA's controller client, redistributed
unmodified under the GNU LGPL v2.1 — see `native\nvdaControllerClient.license.txt`.
Source: <https://github.com/nvaccess/nvda>.
