#!/usr/bin/env bash
#
# Install the NVDA silencer host on Windows, from WSL.
#
# Builds native/ with the Windows .NET SDK, drops the result under
# %LOCALAPPDATA%\Roll20A11y, writes the Native Messaging host manifest next to
# it, and points the registry at that manifest. Re-running it is safe — every
# step overwrites.
#
# The extension must be loaded as an unpacked extension from this repo. Its id
# is pinned by the "key" field in manifest.json, and this script derives the id
# from that same field, so the two cannot drift apart.
#
# Uninstall:
#   reg.exe delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.roll20a11y.silencer" /f
#   rm -rf "$LOCALAPPDATA/Roll20A11y"
#
# Nothing in the extension depends on this host: without it every dialog still
# works, it just costs the screen-reader chatter this exists to cut off.

set -euo pipefail

HOST_NAME="com.roll20a11y.silencer"
EXE_NAME="roll20-a11y-silencer.exe"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

# --- Prerequisites ----------------------------------------------------------

command -v wslpath >/dev/null 2>&1 || die "this script must run inside WSL"

DOTNET="/mnt/c/Program Files/dotnet/dotnet.exe"
[ -x "$DOTNET" ] || die "Windows .NET SDK not found at $DOTNET"

CMD="/mnt/c/Windows/System32/cmd.exe"
REG="/mnt/c/Windows/System32/reg.exe"
[ -x "$CMD" ] || die "cmd.exe not found — is this WSL with interop enabled?"

# --- Where things go --------------------------------------------------------

LOCALAPPDATA_WIN="$("$CMD" /c 'echo %LOCALAPPDATA%' 2>/dev/null | tr -d '\r')"
[ -n "$LOCALAPPDATA_WIN" ] || die "could not read %LOCALAPPDATA%"

INSTALL_WIN="${LOCALAPPDATA_WIN}\\Roll20A11y"
INSTALL_DIR="$(wslpath -u "$INSTALL_WIN")"
BUILD_DIR="$(wslpath -u "${LOCALAPPDATA_WIN}\\Temp")/r20a11y-host-build"

# --- The extension id, derived from manifest.json's pinned key ---------------

EXTENSION_ID="$(python3 - "$REPO/manifest.json" <<'PY'
import base64, hashlib, json, sys
key = json.load(open(sys.argv[1], encoding="utf-8")).get("key")
if not key:
    sys.exit('manifest.json has no "key" field; the extension id is not pinned')
der = base64.b64decode(key)
digest = hashlib.sha256(der).hexdigest()[:32]
print("".join(chr(ord("a") + int(c, 16)) for c in digest))
PY
)"
say "extension id: $EXTENSION_ID"

# --- Build ------------------------------------------------------------------
#
# Built on the Windows filesystem rather than in place: MSBuild over
# \\wsl.localhost is slow and intermittently fails on file locking.

say "building the host…"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
cp "$REPO/native/Program.cs" "$REPO/native/Roll20A11ySilencer.csproj" "$BUILD_DIR/"

BUILD_WIN="$(wslpath -w "$BUILD_DIR")"
"$CMD" /c "cd /d $BUILD_WIN && dotnet publish -c Release --nologo -v quiet -o publish" \
  >/dev/null 2>&1 || die "build failed — run it by hand in $BUILD_WIN to see why"

[ -f "$BUILD_DIR/publish/$EXE_NAME" ] || die "build produced no exe"

# --- Install ----------------------------------------------------------------

mkdir -p "$INSTALL_DIR"
# Everything except the debug symbols, which are of no use to anyone who is
# not attached to this with a debugger.
find "$BUILD_DIR/publish" -maxdepth 1 -type f ! -name '*.pdb' \
  -exec cp {} "$INSTALL_DIR/" \;
say "installed to $INSTALL_WIN"

# NVDA's controller client, shipped with this repo, put beside the exe where the
# host loads it from. This is what makes the silencer independent of where NVDA
# is installed — see native/vendor/nvda-controller-client/README.md.
case "$("$CMD" /c 'echo %PROCESSOR_ARCHITECTURE%' 2>/dev/null | tr -d '\r')" in
  ARM64) CLIENT_ARCH=arm64 ;;
  x86)   CLIENT_ARCH=x86 ;;
  *)     CLIENT_ARCH=x64 ;;
esac
CLIENT="$REPO/native/vendor/nvda-controller-client/$CLIENT_ARCH/nvdaControllerClient.dll"
[ -f "$CLIENT" ] || die "no vendored controller client for $CLIENT_ARCH at $CLIENT"
cp "$CLIENT" "$INSTALL_DIR/nvdaControllerClient.dll"
cp "$REPO/native/vendor/nvda-controller-client/license.txt" \
   "$INSTALL_DIR/nvdaControllerClient.license.txt"
say "bundled controller client ($CLIENT_ARCH) beside it"

MANIFEST="$INSTALL_DIR/${HOST_NAME}.json"
MANIFEST_WIN="${INSTALL_WIN}\\${HOST_NAME}.json"

python3 - "$MANIFEST" "$HOST_NAME" "${INSTALL_WIN}\\${EXE_NAME}" "$EXTENSION_ID" <<'PY'
import json, sys
path, name, exe, extension_id = sys.argv[1:5]
json.dump(
    {
        "name": name,
        "description": "Roll20 Accessibility Helper NVDA silencer host",
        "type": "stdio",
        "path": exe,
        "allowed_origins": ["chrome-extension://%s/" % extension_id],
    },
    open(path, "w", encoding="utf-8"),
    indent=2,
)
PY
say "wrote $MANIFEST_WIN"

# The default value of this key is the full path to the host manifest. Chrome
# reads it at connect time, so no restart is needed — but the extension does
# have to be reloaded if its id changed.
"$REG" add "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}" \
  /ve /t REG_SZ /d "$MANIFEST_WIN" /f >/dev/null
say "registered HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}"

# --- Smoke test -------------------------------------------------------------
#
# Speaks the wire protocol directly, so a failure here is the host's and not
# Chrome's. `nvda` false means NVDA is not running *right now*, which is fine
# at install time but is also exactly what a broken silencer looks like.

python3 - "$INSTALL_DIR/$EXE_NAME" <<'PY'
import json, struct, subprocess, sys
body = json.dumps({"type": "ping"}).encode()
p = subprocess.run([sys.argv[1]], input=struct.pack("<I", len(body)) + body,
                   stdout=subprocess.PIPE, timeout=60)
out = p.stdout
if len(out) < 4:
    sys.exit("host did not reply to a ping")
n = struct.unpack("<I", out[:4])[0]
reply = json.loads(out[4:4 + n])
if not reply.get("ok"):
    sys.exit("host replied %r" % reply)
print("host answered: version %s, NVDA %s, helper %s" % (
    reply.get("version", "?"),
    "detected" if reply.get("nvda") else "NOT RUNNING",
    reply.get("helper") or "not found"))
PY

say
say "Done. Reload the extension at chrome://extensions and refresh the Roll20 tab."
say "Confirm the id shown there is $EXTENSION_ID."
