/**
 * Sends captured lines to the local Flask server (server.py) and keeps the
 * toolbar badge in sync.
 *
 * The background script owns the network request so the content script does
 * not need CORS, and it keeps a persistent queue in chrome.storage.local while
 * the server is down.
 */

const api = globalThis.browser ?? globalThis.chrome;

const SERVER_URL = "http://127.0.0.1:5000";
const TOKEN = "local-demo-token"; // must match server.py
const PENDING_KEY = "pending";
const REQUEST_TIMEOUT_MS = 4000;
const RETRY_DELAY_MS = 5000;

let chain = Promise.resolve();
let retryTimer = null;

/* -------------------------------------------------------------------- */
/* Queue                                                                */
/* -------------------------------------------------------------------- */

function run(task) {
  chain = chain.then(task, task);
  return chain;
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(`${SERVER_URL}${path}`, {
      ...options,
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function postLines(lines) {
  const response = await request("/log", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Demo-Token": TOKEN,
    },
    body: JSON.stringify({ lines }),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

async function readPending() {
  const stored = await api.storage.local.get({ [PENDING_KEY]: [] });
  return Array.isArray(stored[PENDING_KEY]) ? stored[PENDING_KEY] : [];
}

async function drainLocked() {
  const pending = await readPending();
  if (pending.length === 0) return;

  try {
    await postLines(pending);
    await api.storage.local.set({ [PENDING_KEY]: [] });
    clearRetry();
  } catch (error) {
    console.warn("[keystroke-demo] server unavailable:", error.message || error);
    scheduleRetry();
  }
}

function drain() {
  return run(drainLocked);
}

function clearRetry() {
  if (retryTimer === null) return;
  clearTimeout(retryTimer);
  retryTimer = null;
}

function scheduleRetry() {
  if (retryTimer !== null) return;

  retryTimer = setTimeout(() => {
    retryTimer = null;
    drain().catch(() => {});
  }, RETRY_DELAY_MS);
}

function enqueue(lines) {
  return run(async () => {
    const pending = await readPending();
    await api.storage.local.set({ [PENDING_KEY]: pending.concat(lines) });
    await drainLocked();
  });
}

async function clearLog() {
  return run(async () => {
    const response = await request("/log", {
      method: "DELETE",
      headers: { "X-Demo-Token": TOKEN },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    await api.storage.local.set({ [PENDING_KEY]: [] });
  });
}

async function getLog() {
  await drain();

  const response = await request("/log");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const text = await response.text();
  return { text, pending: (await readPending()).length };
}

/* -------------------------------------------------------------------- */
/* Badge                                                                */
/* -------------------------------------------------------------------- */

async function syncBadge() {
  try {
    const { enabled = false } = await api.storage.local.get({ enabled: false });
    await api.action.setBadgeText({ text: enabled ? "ON" : "" });
    if (enabled) await api.action.setBadgeBackgroundColor({ color: "#c0392b" });
  } catch {
    // The badge is cosmetic; never let it break the extension.
  }
}

api.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "enabled" in changes) syncBadge();
});

/* -------------------------------------------------------------------- */
/* Messages from content.js and the popup                              */
/* -------------------------------------------------------------------- */

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === "append-log" && Array.isArray(message.lines)) {
    enqueue(message.lines)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "get-log") {
    getLog()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "clear-log") {
    clearLog()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  return false;
});

/* -------------------------------------------------------------------- */
/* Startup                                                              */
/* -------------------------------------------------------------------- */

function start() {
  syncBadge();
  drain().catch(() => {});
}

api.runtime.onInstalled.addListener(start);
api.runtime.onStartup.addListener(start);
start();
