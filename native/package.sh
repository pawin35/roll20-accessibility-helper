#!/usr/bin/env bash
#
# Build a folder that can be handed to someone else.
#
# The result needs nothing installed on the target machine — no .NET, no WSL,
# no build tools, no Visual C++ redistributable. The host is published
# self-contained, so the .NET runtime travels inside the exe.
#
#     bash native/package.sh [output-directory] [--framework-dependent]
#
# Default output is dist/roll20-a11y/. Copy that folder to the other PC and
# follow the INSTALL.md inside it.
#
# --framework-dependent makes the host 174 KB instead of 14 MB and start a
# little faster, but the target machine then needs a .NET runtime installed
# (any version from 6 up - the csproj rolls forward across majors). Only worth
# it for someone who already has one.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SELF_CONTAINED=1
OUT=""
for arg in "$@"; do
  case "$arg" in
    --framework-dependent) SELF_CONTAINED=0 ;;
    -*) printf 'unknown option: %s\n' "$arg" >&2; exit 2 ;;
    *) OUT="$arg" ;;
  esac
done
OUT="${OUT:-$REPO/dist/roll20-a11y}"

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

command -v wslpath >/dev/null 2>&1 || die "this script must run inside WSL"
CMD="/mnt/c/Windows/System32/cmd.exe"
[ -x "$CMD" ] || die "cmd.exe not found — is this WSL with interop enabled?"
[ -x "/mnt/c/Program Files/dotnet/dotnet.exe" ] || die "Windows .NET SDK not found"

# --- The extension itself ---------------------------------------------------

rm -rf "$OUT"
mkdir -p "$OUT/native"

cp "$REPO/manifest.json" "$REPO/styles.css" "$REPO/background.js" "$OUT/"
cp -r "$REPO/lib" "$REPO/features" "$REPO/page" "$REPO/sounds" "$OUT/"
say "extension: $(find "$OUT" -name '*.js' | wc -l) scripts"

# --- The host ---------------------------------------------------------------
#
# Self-contained, single-file, ReadyToRun, trimmed. The combination is chosen
# for *start-up latency*, not size: the host is launched afresh for every
# dialog close and the extension's lead has to cover that start. R2R keeps it
# near a framework-dependent build; trimming keeps the exe to ~15 MB rather
# than ~70. The exact cost does not have to be guessed at — the host reports it
# in its ping reply and lib/nvda-silence.js sizes the lead from that.

BUILD="$(wslpath -u "$("$CMD" /c 'echo %LOCALAPPDATA%' 2>/dev/null | tr -d '\r')\\Temp")/r20a11y-package"
rm -rf "$BUILD"
mkdir -p "$BUILD"
cp "$REPO/native/Program.cs" "$REPO/native/Roll20A11ySilencer.csproj" "$BUILD/"

if [ "$SELF_CONTAINED" -eq 1 ]; then
  PUBLISH_ARGS="-r win-x64 --self-contained true -p:PublishSingleFile=true \
                -p:PublishReadyToRun=true -p:PublishTrimmed=true"
  say "publishing the host (self-contained, no prerequisites)…"
else
  PUBLISH_ARGS="-r win-x64 --self-contained false"
  say "publishing the host (framework-dependent, needs .NET 6+ on the target)…"
fi

"$CMD" /c "cd /d $(wslpath -w "$BUILD") && dotnet publish -c Release $PUBLISH_ARGS \
  --nologo -v quiet -o publish" >/dev/null 2>&1 \
  || die "publish failed — run it by hand in $BUILD to see why"

EXE="$BUILD/publish/roll20-a11y-silencer.exe"
[ -f "$EXE" ] || die "publish produced no exe"
# A framework-dependent publish is several files (exe, dll, deps.json,
# runtimeconfig.json) and every one of them is needed; a self-contained
# single-file one is just the exe. Copy whatever it produced.
# The globs are permissive because a self-contained single-file publish has no
# .dll or .json at all; the exe copy is the one that must not silently fail.
cp "$BUILD"/publish/*.dll "$BUILD"/publish/*.json "$OUT/native/" 2>/dev/null || true
cp "$EXE" "$OUT/native/"

# win-x64 only: that is what the self-contained publish above targets, so the
# matching controller client is the x64 one. An arm64 package would need both
# changed together.
cp "$REPO/native/vendor/nvda-controller-client/x64/nvdaControllerClient.dll" "$OUT/native/"
cp "$REPO/native/vendor/nvda-controller-client/license.txt" \
   "$OUT/native/nvdaControllerClient.license.txt"
cp "$REPO/native/install.ps1" "$OUT/native/"
if [ "$SELF_CONTAINED" -eq 1 ]; then
  say "host: $(du -k "$OUT/native/roll20-a11y-silencer.exe" | cut -f1) KB, self-contained"
else
  say "host: $(du -sk "$OUT/native" | cut -f1) KB, framework-dependent (needs .NET 6+)"
fi

# --- Instructions -----------------------------------------------------------

EXTENSION_ID="$(python3 - "$REPO/manifest.json" <<'PY'
import base64, hashlib, json, sys
der = base64.b64decode(json.load(open(sys.argv[1], encoding="utf-8"))["key"])
print("".join(chr(ord("a") + int(c, 16)) for c in hashlib.sha256(der).hexdigest()[:32]))
PY
)"

sed "s/__EXTENSION_ID__/$EXTENSION_ID/g" "$REPO/native/INSTALL.template.md" > "$OUT/INSTALL.md"

if [ "$SELF_CONTAINED" -eq 0 ]; then
  cat >> "$OUT/INSTALL.md" <<'NOTE'

## Note for this build

This copy was packaged **framework-dependent** to keep it small. Step 3 needs
the .NET runtime on this machine — any version from 6 upwards. If `install.ps1`
reports that the host did not answer, that is usually why:
<https://dotnet.microsoft.com/download/dotnet>

Steps 1 and 2 do not need it, and neither does anything else in the extension.
NOTE
fi

# --- Check the package is complete ------------------------------------------
#
# The copies above name directories, so a new file in an existing directory is
# picked up for free but a whole new *kind* of file is not. Rather than trust
# that, ask the manifest what it needs and confirm every one of them arrived:
# a missing content script is a feature that silently fails to load on someone
# else's machine, which is the worst possible place to find out.

python3 - "$OUT" <<'VERIFY'
import json, os, sys

out = sys.argv[1]
manifest = json.load(open(os.path.join(out, "manifest.json"), encoding="utf-8"))

wanted = ["manifest.json", "styles.css"]
if "background" in manifest:
    wanted.append(manifest["background"]["service_worker"])
for entry in manifest.get("content_scripts", []):
    wanted += entry.get("js", []) + entry.get("css", [])
for entry in manifest.get("web_accessible_resources", []):
    wanted += entry.get("resources", [])

missing = sorted({w for w in wanted if not os.path.exists(os.path.join(out, w))})
if missing:
    sys.exit("package is incomplete, missing:\n  " + "\n  ".join(missing))
print("verified %d files named by the manifest" % len(set(wanted)))
VERIFY

say
say "packaged into $OUT"
say "  total $(du -sk "$OUT" | cut -f1) KB, extension id $EXTENSION_ID"
say "Copy that folder to the other PC and open INSTALL.md."
