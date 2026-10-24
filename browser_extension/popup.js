(() => {
  "use strict";

  const api = globalThis.browser ?? globalThis.chrome;

  const stateEl = document.getElementById("state");
  const toggleEl = document.getElementById("toggle");
  const clearEl = document.getElementById("clear");
  const serverEl = document.getElementById("server");
  const pendingEl = document.getElementById("pending");
  const logEl = document.getElementById("log");

  let enabled = false;
  let refreshing = false;

  function renderState() {
    stateEl.textContent = enabled ? "Recording" : "Paused";
    stateEl.className = enabled ? "on" : "off";
    toggleEl.textContent = enabled ? "Stop" : "Start";
    toggleEl.classList.toggle("primary", enabled);
  }

  function setServerStatus(state, detail = "") {
    if (state === "online") {
      serverEl.textContent = "Server: online";
      serverEl.className = "online";
    } else if (state === "offline") {
      serverEl.textContent = "Server: offline";
      serverEl.className = "offline";
      serverEl.title = detail;
    } else {
      serverEl.textContent = "Server: checking…";
      serverEl.className = "unknown";
    }
  }

  async function refreshLog() {
    if (refreshing) return;
    refreshing = true;

    try {
      const response = await api.runtime.sendMessage({ type: "get-log" });
      if (!response || !response.ok) {
        throw new Error(response?.error || "server offline");
      }

      if (logEl.value !== response.text) {
        const atBottom =
          logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 24;
        logEl.value = response.text;
        if (atBottom) logEl.scrollTop = logEl.scrollHeight;
      }
      pendingEl.textContent =
        response.pending > 0 ? `${response.pending} line(s) queued` : "";
      setServerStatus("online");
    } catch (error) {
      pendingEl.textContent = "";
      setServerStatus("offline", String(error.message || error));
    } finally {
      refreshing = false;
    }
  }

  async function readState() {
    const stored = await api.storage.local.get({ enabled: false });
    enabled = Boolean(stored.enabled);
    renderState();
  }

  toggleEl.addEventListener("click", async () => {
    enabled = !enabled;
    await api.storage.local.set({ enabled });
    renderState();

    // Give the content scripts a moment to flush the pending word.
    setTimeout(refreshLog, 400);
  });

  clearEl.addEventListener("click", async () => {
    clearEl.disabled = true;

    try {
      const response = await api.runtime.sendMessage({ type: "clear-log" });
      if (!response || !response.ok) {
        throw new Error(response?.error || "server offline");
      }
      logEl.value = "";
    } catch (error) {
      setServerStatus("offline", String(error.message || error));
    } finally {
      clearEl.disabled = false;
      refreshLog();
    }
  });

  // Keep the popup in sync when capture is stopped from a page (Esc).
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !("enabled" in changes)) return;
    enabled = Boolean(changes.enabled.newValue);
    renderState();
  });

  readState().then(refreshLog);
  setInterval(refreshLog, 1500);
})();
