# NVDA Controller Client — vendored

`nvdaControllerClient.dll`, unmodified, from NV Access's official release
package. `native/Program.cs` loads it at run time to call
`nvdaController_cancelSpeech`; nothing else in the repo touches it.

| | |
|---|---|
| Version | 2.0, from the NVDA **2026.1.1** release package |
| Source | <https://www.nvaccess.org/files/nvda/releases/2026.1.1/nvda_2026.1.1_controllerClient.zip> |
| Upstream | <https://github.com/nvaccess/nvda> (`scons source client`) |
| Licence | GNU LGPL v2.1 — see `license.txt` |

## Why it is here rather than found on disk

NVDA does **not** install this DLL. It installs `nvdaHelperRemote.dll`, which
exports the same entry points, at `NVDA\lib\<version>\<arch>\` — a path that is
NVDA's private business, is absent for a portable copy, and moves when NVDA
reorganises. Guessing at it made the silencer depend on where NVDA happened to
be installed. Shipping the client removes the question: the host loads the copy
sitting next to its own executable.

`native/install.sh` copies the architecture matching the machine to
`%LOCALAPPDATA%\Roll20A11y\nvdaControllerClient.dll`.

## Licence compliance

LGPL v2.1 permits distribution alongside a work that merely uses the library,
provided the library is unmodified, dynamically linked, and its licence and
source are available. All three hold: the DLL is byte-identical to the release
package, loaded at run time via `NativeLibrary.Load`, `license.txt` ships beside
it, and the upstream source is linked above. NV Access states the intent
directly in the package readme — "`*.dll` file, which you can distribute with
your application."

## Compatibility across NVDA versions — verified, not assumed

**One copy works for every NVDA from 2021.1 to 2026.x.** The reason is the RPC
interface UUID, which is what a client and NVDA actually agree on:

| NVDA release | v1 interface (ours) | v2 interface | exports |
|---|---|---|---|
| 2021.1 | `dff50b99-f7fd-4ca7-a82c-daeb3e025295` v1.0 | — | 4 |
| 2022.1 | `dff50b99-…` v1.0 | — | 4 |
| 2023.3 | `dff50b99-…` v1.0 | — | 4 |
| 2024.1 | `dff50b99-…` v1.0 | `3d168d45-cb58-4270-8257-4e0be515d557` v1.0 | 7 |
| 2025.1 | `dff50b99-…` v1.0 | `3d168d45-…` v1.0 | 7 |
| 2026.1.1 (this copy) | `dff50b99-…` v1.0 | `3d168d45-…` v1.0 | 7 |

Read out of each release's own `controllerClient.zip` by parsing the
`RPC_CLIENT_INTERFACE` structs in the x64 DLL — the interface UUID sits 20 bytes
ahead of the NDR transfer-syntax GUID.

The v1 UUID has not changed in five years, and
`nvdaController_testIfRunning` and `nvdaController_cancelSpeech` — the only two
functions this project calls — live on it. Version 2.0 did **not** revise that
interface; it added a *second, separate* one for `getProcessId`, `speakSsml` and
`setOnSsmlMarkReachedCallback`. That is precisely why NV Access documents older
NVDA as returning `RPC_S_UNKNOWN_IF` for those three and says nothing about the
rest: the second interface is unregistered, the first is fine.

Below 2021.1 is untested — NV Access no longer publishes those packages (2019.3
returns nothing), so there was no DLL to inspect.

**No runtime to install.** The DLL imports `USER32`, `RPCRT4` and `KERNEL32`
only — no VC++ redistributable, on any of the three architectures.

**And if it ever is wrong**, the host copes: `Probe()` in `native/Program.cs`
treats "the DLL loaded" as insufficient and requires `testIfRunning` to actually
answer. A bundled client that cannot reach the installed NVDA is kept only as a
provisional binding while the search falls through to that NVDA's own
`nvdaHelperRemote.dll`, which is version-matched by construction. Verified by
removing the bundled DLL and watching `ping` resolve to
`…\NVDA\lib\2026.1.1\x64\nvdaHelperRemote.dll` instead.

## A naming change, if you ever swap this copy out

Packages before 2024.1 ship `nvdaControllerClient64.dll` / `…32.dll`; 2024.1 and
later ship one `nvdaControllerClient.dll` per architecture directory. Immaterial
here — `install.sh` renames whatever it copies — but it will confuse a glob.
