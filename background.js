/**
 * The extension's only background script, and it does one thing: relay between
 * a content script and the NVDA silencer host.
 *
 * It has to exist because `chrome.runtime.sendNativeMessage` and
 * `connectNative` are not exposed to content scripts — only to extension pages
 * and the service worker. Everything else in this extension is a content
 * script, and this file is deliberately kept to a relay so it stays that way.
 *
 * **The port is long-lived.** The obvious implementation is one
 * `sendNativeMessage` per request, which launches a fresh host process each
 * time — and since NVDA cannot be cancelled until that process is up, the whole
 * lead before focus moves existed to cover the launch. Holding a port open
 * turns a process start into a pipe write. The host stays alive until the port
 * closes, so it is closed after a spell of inactivity rather than left running
 * for the life of the browser.
 *
 * See lib/nvda-silence.js for the caller and native/ for the host.
 */

const HOST = "com.roll20a11y.silencer";

/**
 * How long a request may take before the caller is told it failed. Generous:
 * a `silence` deliberately does not reply until it has finished, and the only
 * thing this really guards against is a host that has wedged.
 */
const REQUEST_TIMEOUT_MS = 10000;

/**
 * Drop the port, and with it the host process, after this long without a
 * request. Long enough to span a lull at the table, short enough that a browser
 * left open overnight is not also leaving a native process running.
 */
const IDLE_MS = 10 * 60 * 1000;

/**
 * A service worker is recycled after ~30 s idle, which would take the port and
 * the host with it. While a port is open the timer is kept from expiring by
 * touching an extension API — that is what resets it.
 */
const KEEPALIVE_MS = 20000;

let port = null;
let nextId = 0;
const pending = new Map();

let keepaliveTimer = null;
let idleTimer = null;

// --- Port lifetime ----------------------------------------------------------

function closePort() {
  const dying = port;
  port = null;
  stopTimers();
  // Everything still waiting is never going to be answered now.
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject();
    pending.delete(id);
  }
  if (dying) {
    try {
      dying.disconnect();
    } catch (e) {
      /* already gone */
    }
  }
}

function stopTimers() {
  if (keepaliveTimer !== null) clearInterval(keepaliveTimer);
  if (idleTimer !== null) clearTimeout(idleTimer);
  keepaliveTimer = null;
  idleTimer = null;
}

function touch() {
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = setTimeout(closePort, IDLE_MS);
}

/** The open port, opening one if there is none. Null when there is no host. */
function ensurePort() {
  if (port) return port;

  let opened;
  try {
    opened = chrome.runtime.connectNative(HOST);
  } catch (e) {
    // No host registered. The ordinary case on a machine that never installed
    // one, and on every non-Windows machine.
    return null;
  }

  opened.onMessage.addListener((message) => {
    const id = message && message.id;
    const entry = pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(id);
    entry.resolve(message);
  });

  opened.onDisconnect.addListener(() => {
    // Reading lastError here keeps Chrome from logging it as unchecked; there
    // is nothing to do about it beyond dropping the port.
    void chrome.runtime.lastError;
    if (port === opened) closePort();
  });

  port = opened;
  keepaliveTimer = setInterval(() => {
    // The call itself is irrelevant; being an extension API call is the point.
    chrome.runtime.getPlatformInfo(() => void chrome.runtime.lastError);
  }, KEEPALIVE_MS);
  touch();
  return port;
}

// --- Requests ---------------------------------------------------------------

function request(payload) {
  return new Promise((resolve, reject) => {
    const open = ensurePort();
    if (!open) return reject();

    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject();
    }, REQUEST_TIMEOUT_MS);

    pending.set(id, { resolve, reject, timer });
    try {
      open.postMessage(Object.assign({ id }, payload));
      touch();
    } catch (e) {
      clearTimeout(timer);
      pending.delete(id);
      // The port looked open and was not. Drop it so the next request opens a
      // fresh one rather than posting into the same dead pipe.
      closePort();
      reject();
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const payload = message && message.r20a11yNative;
  // Not ours. Returning undefined leaves the channel for another listener.
  if (!payload) return undefined;

  request(payload).then(
    (reply) => sendResponse({ reply }),
    // Reported as data rather than left to throw: a missing host is expected,
    // and the caller reads any `error` as "no silencer; carry on without it".
    () => sendResponse({ error: "native host unavailable" })
  );

  // Keep the message channel open for the asynchronous reply above.
  return true;
});
