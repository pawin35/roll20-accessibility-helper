// Roll20 Accessibility Helper — NVDA silencer (Windows only).
//
// Why this exists
// ---------------
// When a dialog in the page closes, focus goes back to the control that opened
// it and NVDA answers by reading that control *and* everything it sits inside —
//
//     Ability scores  table with 7 rows and 5 columns  Roll Strength +1
//     saving throw  button
//
// — over the top of the roll result the user pressed the key for. Parking
// focus, deferring the hand-back, and making the live region assertive were all
// tried and none of them got in front of it; see "What was tried and did not
// work" in CLAUDE.md.
//
// Nothing on the web side can. What does work is asking NVDA directly, through
// its controller API — and that needs a Windows process, which a content script
// is not. That is all this program is: no window, no UI, one verb.
//
// (An earlier version of this host also *was* the dialog, a WinForms window
// outside Chrome. That removed the in-page focus move but not the symptom —
// handing the OS foreground back to Chrome makes NVDA re-announce the same
// context anyway — so the window is gone and the silencer, which is the part
// that worked, is not.)
//
// Wire protocol
// -------------
// Chrome Native Messaging over stdio: each message, in both directions, is a
// 4-byte little-endian unsigned length followed by that many bytes of UTF-8
// JSON.
//
// This host is **long-lived**: it reads requests in a loop until Chrome closes
// the pipe. It used to answer one and exit, which meant a fresh process for
// every dialog close - and since cancelling cannot start until the process is
// up, the whole lead before focus moves existed to cover that start. Over a
// port that is already open the cost is a pipe write, so the lead can shrink to
// almost nothing.
//
// Every reply echoes the request's `id`, because with a port there can be more
// than one request in flight and the caller has to match them up.
//
// **stdout is the wire.** A single stray `Console.WriteLine` corrupts the
// stream and Chrome kills the process. There is no logging in this file for
// that reason; errors travel back inside the JSON reply.
//
// Verbs
// -----
//   {"type":"ping"}              -> {"ok":true,"version":"…","nvda":bool,"helper":"…"}
//   {"type":"silence","ms":600}  -> {"silenced":bool}
//
// `silence` replies only once it has finished, so a caller that waits on it
// knows the coast is clear.

using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;

namespace Roll20A11ySilencer
{
    internal static class Program
    {
        private const string Version = "2.0.0";

        // A message is capped at 1 MB by Chrome in both directions.
        private const int MaxMessage = 1024 * 1024;

        // Refuse to sit there cancelling forever if asked to by a bad caller.
        private const int MaxSilenceMilliseconds = 5000;

        private static int Main()
        {
            Stream stdin = Console.OpenStandardInput();
            Stream stdout = Console.OpenStandardOutput();

            // One request at a time, in order. A `silence` occupies the loop
            // for its duration, which is correct: there is nothing useful to do
            // concurrently, and NVDA is being cancelled throughout.
            while (true)
            {
                string raw;
                try
                {
                    raw = ReadMessage(stdin);
                }
                catch (IOException)
                {
                    return 0;
                }

                // Chrome closed the pipe: the service worker was recycled, the
                // browser quit, or the port was dropped. Nothing left to serve.
                if (raw == null) return 0;

                Dictionary<string, object> reply;
                object id = null;
                try
                {
                    using JsonDocument doc = JsonDocument.Parse(raw);
                    id = GetId(doc.RootElement);
                    reply = Handle(doc.RootElement);
                }
                catch (Exception e)
                {
                    reply = new Dictionary<string, object> { ["error"] = e.Message };
                }

                if (id != null) reply["id"] = id;

                try
                {
                    WriteMessage(stdout, reply);
                }
                catch (IOException)
                {
                    // Chrome went away while we were working. Nowhere to send
                    // the answer, and nothing useful to do about it.
                    return 0;
                }
            }
        }

        /// <summary>
        /// The caller's correlation id, echoed back untouched. Left as a
        /// number or a string rather than parsed, since it means nothing here.
        /// </summary>
        private static object GetId(JsonElement request)
        {
            if (request.ValueKind != JsonValueKind.Object) return null;
            if (!request.TryGetProperty("id", out JsonElement id)) return null;
            if (id.ValueKind == JsonValueKind.String) return id.GetString();
            if (id.ValueKind == JsonValueKind.Number && id.TryGetInt64(out long n)) return n;
            return null;
        }

        private static Dictionary<string, object> Handle(JsonElement request)
        {
            switch (GetString(request, "type", ""))
            {
                case "ping":
                    // The NVDA fields are diagnostics: they are the only way to
                    // tell "the silencer is working" from "the silencer found
                    // nothing to talk to" without pressing a key and listening.
                    return new Dictionary<string, object>
                    {
                        ["ok"] = true,
                        ["version"] = Version,
                        ["nvda"] = Nvda.Running,
                        ["helper"] = Nvda.Source,
                        // How long this process took to become able to answer.
                        // The caller sizes its lead from this, so a slower
                        // machine or a self-contained build (which starts more
                        // slowly than a framework-dependent one) tunes itself
                        // instead of relying on a constant measured elsewhere.
                        ["startupMs"] = StartupMilliseconds(),
                    };

                case "silence":
                    int ms = GetInt(request, "ms", 600);
                    if (ms > MaxSilenceMilliseconds) ms = MaxSilenceMilliseconds;
                    return new Dictionary<string, object>
                    {
                        ["silenced"] = Nvda.Silence(ms),
                    };

                default:
                    return new Dictionary<string, object>
                    {
                        ["error"] = "unknown request type",
                    };
            }
        }

        /// <summary>
        /// Milliseconds from process creation to now — runtime start-up
        /// included, which is most of it and the part a Stopwatch in Main
        /// would miss.
        /// </summary>
        private static int StartupMilliseconds()
        {
            try
            {
                using Process self = Process.GetCurrentProcess();
                double ms = (DateTime.UtcNow - self.StartTime.ToUniversalTime())
                    .TotalMilliseconds;
                return ms < 0 || ms > 60000 ? 0 : (int)ms;
            }
            catch (Exception)
            {
                return 0;
            }
        }

        // --- Framing ------------------------------------------------------

        private static string ReadMessage(Stream stdin)
        {
            byte[] header = ReadExactly(stdin, 4);
            if (header == null) return null;

            int length = BinaryPrimitives.ReadInt32LittleEndian(header);
            if (length <= 0 || length > MaxMessage) return null;

            byte[] body = ReadExactly(stdin, length);
            return body == null ? null : Encoding.UTF8.GetString(body);
        }

        private static void WriteMessage(Stream stdout, Dictionary<string, object> value)
        {
            byte[] body = JsonSerializer.SerializeToUtf8Bytes(value);
            byte[] header = new byte[4];
            BinaryPrimitives.WriteInt32LittleEndian(header, body.Length);
            stdout.Write(header, 0, header.Length);
            stdout.Write(body, 0, body.Length);
            stdout.Flush();
        }

        /// <summary>
        /// Reads exactly <paramref name="count"/> bytes, or null if the pipe
        /// ends first. A pipe is free to return short reads, so a single
        /// Read() is not enough even for the 4-byte header.
        /// </summary>
        private static byte[] ReadExactly(Stream stream, int count)
        {
            byte[] buffer = new byte[count];
            int filled = 0;
            while (filled < count)
            {
                int read = stream.Read(buffer, filled, count - filled);
                if (read <= 0) return null;
                filled += read;
            }
            return buffer;
        }

        // --- JSON helpers -------------------------------------------------

        private static string GetString(JsonElement element, string name, string fallback)
        {
            if (element.ValueKind != JsonValueKind.Object) return fallback;
            if (!element.TryGetProperty(name, out JsonElement value)) return fallback;
            if (value.ValueKind != JsonValueKind.String) return fallback;
            string text = value.GetString();
            return string.IsNullOrEmpty(text) ? fallback : text;
        }

        private static int GetInt(JsonElement element, string name, int fallback)
        {
            if (element.ValueKind != JsonValueKind.Object) return fallback;
            if (!element.TryGetProperty(name, out JsonElement value)) return fallback;
            if (value.ValueKind != JsonValueKind.Number) return fallback;
            return value.TryGetInt32(out int number) ? number : fallback;
        }
    }

    /// <summary>
    /// NVDA's controller API.
    ///
    /// `nvdaControllerClient.dll` ships **next to this executable** — see
    /// native/vendor/nvda-controller-client. That is the whole answer to "where
    /// is the DLL": it is at a path we control, so there is nothing to discover
    /// and nothing that depends on where NVDA was installed, whether it was
    /// installed at all (a portable copy has no install), or how NVDA chooses
    /// to lay out its own directory this year.
    ///
    /// The search of an NVDA installation below is a **fallback**, kept only
    /// for a host built by hand without the vendored DLL beside it. It looks
    /// for `nvdaHelperRemote.dll`, which NVDA does install and which exports
    /// the same entry points, and asks the running NVDA process where it lives
    /// before falling back to the registry and then to guesswork.
    ///
    /// Everything here fails soft: no NVDA, no DLL, or exports moved by a
    /// future version all end in doing nothing. This is NVDA-specific; JAWS and
    /// Narrator have no equivalent call.
    /// </summary>
    internal static class Nvda
    {
        // Cancel repeatedly rather than once: the announcement is queued at the
        // moment focus lands, so the point is to keep cutting it off for as
        // long as it might be queued, not to cancel at one instant.
        private const int PollMilliseconds = 25;

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate uint ControllerCall();

        private static ControllerCall testIfRunning;
        private static ControllerCall cancelSpeech;
        private static bool probed;
        private static string source;

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr GetModuleHandleW(string name);

        /// <summary>
        /// Where the entry points came from, for diagnostics: "injected" when
        /// NVDA had already loaded the helper into this process, a path when we
        /// loaded it ourselves, null when neither.
        /// </summary>
        public static string Source
        {
            get
            {
                Probe();
                return source;
            }
        }

        public static bool Running
        {
            get
            {
                Probe();
                return Answers();
            }
        }

        /// <summary>
        /// Hold NVDA quiet for <paramref name="milliseconds"/>, and return only
        /// once done — so a caller that waits on the reply knows when it is
        /// safe to say something it wants heard.
        /// </summary>
        public static bool Silence(int milliseconds)
        {
            if (milliseconds <= 0 || !Running) return false;

            DateTime deadline = DateTime.UtcNow.AddMilliseconds(milliseconds);
            while (DateTime.UtcNow < deadline)
            {
                Cancel();
                Thread.Sleep(PollMilliseconds);
            }
            return true;
        }

        private static void Cancel()
        {
            if (cancelSpeech == null) return;
            try
            {
                cancelSpeech();
            }
            catch (Exception)
            {
                // A cancelled cancel is not worth reacting to.
            }
        }

        /// <summary>
        /// Bind to whichever copy of the controller API can actually reach
        /// NVDA.
        ///
        /// Sources are tried best-first, but "it loaded" is not the test —
        /// `Answers()` is. A DLL that loads and exports the right symbols can
        /// still be talking to nobody, and the two cases are indistinguishable
        /// from the load alone. So a source that loads *and* gets an answer
        /// wins immediately; a source that only loads is kept as a provisional
        /// binding and the search continues. That is what lets a machine with
        /// an NVDA too old for the bundled client fall through to that NVDA's
        /// own helper, which is version-matched by construction.
        /// </summary>
        private static void Probe()
        {
            if (probed) return;
            probed = true;

            bool bound = false;

            // 1. The bundled client, beside this executable. The normal case,
            //    and the only source whose path is not a guess.
            string bundled = Path.Combine(
                AppContext.BaseDirectory, "nvdaControllerClient.dll");
            if (TryBind(bundled))
            {
                source = bundled;
                if (Answers()) return;
                bound = true;
            }

            // 2. NVDA's helper, if it has already been injected into this
            //    process — then there is nothing to find.
            IntPtr injected = GetModuleHandleW("nvdaHelperRemote.dll");
            if (injected != IntPtr.Zero && Bind(injected))
            {
                source = "injected";
                if (Answers()) return;
                bound = true;
            }

            // 3. NVDA's helper on disk. Only reached when the bundled client
            //    is missing or cannot talk to this NVDA.
            foreach (string path in Candidates())
            {
                if (!TryBind(path)) continue;
                source = path;
                if (Answers()) return;
                bound = true;
            }

            if (!bound)
            {
                testIfRunning = null;
                cancelSpeech = null;
                source = null;
            }
        }

        /// <summary>Is NVDA on the other end of the current binding?</summary>
        private static bool Answers()
        {
            try
            {
                return testIfRunning != null && testIfRunning() == 0;
            }
            catch (Exception)
            {
                return false;
            }
        }

        private static bool TryBind(string path)
        {
            try
            {
                return !string.IsNullOrEmpty(path)
                    && File.Exists(path)
                    && Bind(NativeLibrary.Load(path));
            }
            catch (Exception)
            {
                // Wrong architecture, missing dependency, locked file.
                return false;
            }
        }

        /// <summary>
        /// Resolve the two entry points, leaving any previous binding intact if
        /// this one does not work out — otherwise a failed later attempt would
        /// throw away a good earlier one.
        /// </summary>
        private static bool Bind(IntPtr handle)
        {
            try
            {
                ControllerCall running = Marshal.GetDelegateForFunctionPointer<ControllerCall>(
                    NativeLibrary.GetExport(handle, "nvdaController_testIfRunning"));
                ControllerCall cancel = Marshal.GetDelegateForFunctionPointer<ControllerCall>(
                    NativeLibrary.GetExport(handle, "nvdaController_cancelSpeech"));
                testIfRunning = running;
                cancelSpeech = cancel;
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }

        /// <summary>
        /// Every copy of `nvdaHelperRemote.dll` under any directory that might
        /// be NVDA, best first.
        ///
        /// Searched recursively rather than at the known
        /// `lib\&lt;version&gt;\&lt;arch&gt;\` path, because that layout is
        /// NVDA's private business and has no promise attached to it. The
        /// ordering below is only a preference — Probe tries them in turn.
        /// </summary>
        private static IEnumerable<string> Candidates()
        {
            string arch = RuntimeInformation.ProcessArchitecture switch
            {
                Architecture.X86 => "x86",
                Architecture.Arm64 => "arm64",
                _ => "x64",
            };

            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string root in NvdaDirectories())
            {
                if (root == null || !seen.Add(root) || !Directory.Exists(root)) continue;

                string[] found;
                try
                {
                    found = Directory.GetFiles(
                        root, "nvdaHelperRemote.dll", SearchOption.AllDirectories);
                }
                catch (Exception)
                {
                    continue;
                }

                // Matching architecture first; then reverse alphabetical, which
                // puts the newest version directory ahead of the leftovers NVDA
                // does not remove when it updates.
                Array.Sort(found, (a, b) =>
                {
                    int byArch = Rank(a, arch).CompareTo(Rank(b, arch));
                    return byArch != 0
                        ? byArch
                        : StringComparer.OrdinalIgnoreCase.Compare(b, a);
                });

                foreach (string path in found) yield return path;
            }
        }

        private static int Rank(string path, string arch)
        {
            string parent = Path.GetFileName(Path.GetDirectoryName(path) ?? string.Empty);
            return string.Equals(parent, arch, StringComparison.OrdinalIgnoreCase) ? 0 : 1;
        }

        /// <summary>Directories that might be an NVDA, most reliable first.</summary>
        private static IEnumerable<string> NvdaDirectories()
        {
            // 1. The running NVDA. Exact, and the only one of these that finds
            //    a portable copy — which has no installer and no registry key.
            //    NVDA must be running for cancelSpeech to do anything at all,
            //    so this is nearly always the one that answers.
            string running = null;
            try
            {
                foreach (Process process in Process.GetProcessesByName("nvda"))
                {
                    using (process)
                    {
                        try
                        {
                            running = Path.GetDirectoryName(process.MainModule.FileName);
                        }
                        catch (Exception)
                        {
                            // Access denied, or a bitness mismatch reading the
                            // module list. Fall through to the other routes.
                        }
                    }
                    if (running != null) break;
                }
            }
            catch (Exception)
            {
            }
            yield return running;

            // 2. What the installer recorded. Handles a custom install
            //    directory, but says nothing about a portable copy.
            foreach (string view in new[]
            {
                @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\NVDA",
                @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\NVDA",
            })
            {
                string installed = null;
                try
                {
                    using Microsoft.Win32.RegistryKey key =
                        Microsoft.Win32.Registry.LocalMachine.OpenSubKey(view);
                    installed = key?.GetValue("InstallDir") as string
                        ?? key?.GetValue("UninstallDirectory") as string;
                }
                catch (Exception)
                {
                }
                yield return installed;
            }

            // 3. The default locations, for a machine whose registry has been
            //    cleaned up but whose NVDA is still where it was put.
            foreach (string variable in new[] { "ProgramW6432", "ProgramFiles", "ProgramFiles(x86)" })
            {
                string root = Environment.GetEnvironmentVariable(variable);
                yield return string.IsNullOrEmpty(root) ? null : Path.Combine(root, "NVDA");
            }
        }
    }
}
