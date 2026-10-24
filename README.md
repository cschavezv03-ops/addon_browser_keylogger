# Keystroke Monitor Demo (browser extension + local server)

Educational Firefox extension that captures keystrokes typed on web pages and
sends them to a local Flask server (`127.0.0.1:5000`). The server appends the
words to `browser_extension/log.txt`, together with the timestamp and the URL of
the page where each word was typed.

> Use it only on a browser and on pages you own or have permission to test. By
> default it also records what is typed into password fields; set
> `SKIP_PASSWORD_FIELDS` to `true` in `browser_extension/content.js` if you do not
> want that.

## Requirements

- Firefox 140 or newer.
- Python 3.10 or newer.

## 1. Install dependencies and start the server

From the project root:

```bash
./run_server.sh
```

The first time it creates/uses `.venv` and installs Flask. It should print:

```
[log] writing to .../browser_extension/log.txt
[log] listening on http://127.0.0.1:5000
```

Manual alternative:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python browser_extension/server.py
```

Check that it responds:

```bash
curl http://127.0.0.1:5000/log
```

## 2. Load the extension in Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select `browser_extension/manifest.json`.
4. **Reload the tab** where you are going to type. Content scripts are not
   injected into tabs that were already open before the extension was
   installed/reloaded.
5. Click the extension icon and then **Start**. The badge must show `ON` and the
   popup must say **Server: online**.

## 3. Test it

Type on a normal web page (for example `https://example.com`), not in the popup
and not on `about:` pages.

- Pressing **Space**, **Enter** or **Tab** closes the current word.
- If you stop typing for 2 seconds, the word in progress is saved too.
- Switching tabs/windows or closing the tab sends whatever is pending.
- **Esc** stops capture.

Check the file:

```bash
tail -f browser_extension/log.txt
```

Each line has this format:

```
2026-10-24 17:36:11 | https://example.com/login | palabra
```

Fields:

1. **Timestamp** of the first character of the word.
2. **Page URL** where that word started. It is the URL of the frame that
   received the keystrokes; URLs longer than 500 characters are truncated.
3. **Word** that was typed.

The full URL is logged, including its query string. Avoid testing on pages whose
URL contains sensitive tokens.

## If nothing is saved to `log.txt`

1. **Is the server running?**
   ```bash
   curl http://127.0.0.1:5000/log
   ```
   If it says `Connection refused`, the server is not running.

2. **Did the server start with the right Python?**
   The classic error is:
   ```
   ModuleNotFoundError: No module named 'flask'
   ```
   That happens when the `.venv` was copied from another project or its `pip`
   points somewhere else. In this repository it is already fixed; if it happens
   again:
   ```bash
   .venv/bin/python -m pip install -r requirements.txt
   ```
   and start it with `.venv/bin/python browser_extension/server.py`.

3. **Is capture enabled?**
   Open the popup: it must say **Recording** and **Server: online**. If it says
   **Paused**, click **Start**.

4. **Did you reload the tab after installing the extension?** This is required.

5. **Are you typing on a normal page?** The extension does not capture the
   address bar, the popup, `about:addons`, `about:debugging` or other privileged
   pages. If you test with a local file, serve it over HTTP (for example
   `python3 -m http.server 8000`) instead of `file://`, because Firefox may not
   inject content scripts into `file://` pages.

6. **Are you looking at the right `log.txt`?** It is
   `browser_extension/log.txt`, next to `server.py`. It is not the one in
   `keylogger_in_python/`.

7. **Check the console:** in `about:debugging` → **Inspect** the extension
   (background) or open the tab console to see errors from
   `content.js`/`background.js`.

8. **Private window?** Extensions do not run in private windows by default. In
   `about:addons` → extension → **Permissions**, enable **Run in Private
   Windows** if you need to test there.

9. **Port 5000 already in use?** Check with `ss -ltnp | grep 5000`. If another
   process uses it, change the port in `server.py`, in `background.js`
   (`SERVER_URL`) and in `manifest.json` (`host_permissions`).

## Structure

```
addon_browser_keylogger/
├── browser_extension/
│   ├── manifest.json
│   ├── background.js   # queue and POST to the server
│   ├── content.js      # captures keydown, builds words, adds URL
│   ├── popup.html
│   ├── popup.js
│   ├── server.py       # Flask: writes log.txt
│   └── log.txt         # created when the server starts
├── requirements.txt
├── run_server.sh
└── README.md
```

## Notes

- Only keystrokes inside web pages are captured; this is not an OS-wide
  keylogger.
- Ctrl/Alt/Meta shortcuts, IME composition and special keys are ignored.
- The server listens only on `127.0.0.1`, so it is not exposed to the network.
- The page URL is read with `location.href`. For same-origin and cross-origin
  iframes this is the iframe URL, which is the frame that received the keys.
- The manifest uses `background.scripts`, which is what Firefox supports for
  Manifest V3. For Chrome you would need
  `"background": { "service_worker": "background.js" }`.
