"""Local receiver for the browser-extension keylogger demo.

The extension sends batches of "timestamp | word" lines to

    POST http://127.0.0.1:5000/log

and this server appends them to log.txt next to this file. It binds to
localhost only, so nothing is exposed to the network.

Run it with:

    pip install flask
    python server.py
"""

from pathlib import Path
from threading import Lock

from flask import Flask, Response, jsonify, request

LOG_FILE = Path(__file__).with_name("log.txt")
TOKEN = "local-demo-token"  # must match browser_extension/background.js
MAX_LINES = 1000
READ_TAIL = 20000  # characters returned by GET /log

app = Flask(__name__)
write_lock = Lock()


@app.after_request
def allow_extension_writes(response):
    """CORS for writes only: a random website cannot read the log via GET."""
    if request.method in {"POST", "DELETE", "OPTIONS"}:
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "POST, DELETE, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Demo-Token"
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


def token_is_valid():
    return request.headers.get("X-Demo-Token") == TOKEN


@app.route("/log", methods=["GET", "POST", "DELETE", "OPTIONS"])
def log_endpoint():
    if request.method == "OPTIONS":
        return "", 204

    if request.method == "GET":
        if not LOG_FILE.exists():
            return Response("", mimetype="text/plain")
        with write_lock:
            text = LOG_FILE.read_text(encoding="utf-8")
        return Response(text[-READ_TAIL:], mimetype="text/plain")

    if not token_is_valid():
        return jsonify(ok=False, error="invalid token"), 403

    if request.method == "DELETE":
        with write_lock:
            LOG_FILE.write_text("", encoding="utf-8")
        print(f"[log] cleared {LOG_FILE}", flush=True)
        return jsonify(ok=True)

    payload = request.get_json(silent=True) or {}
    lines = payload.get("lines")

    if not isinstance(lines, list) or not all(isinstance(line, str) for line in lines):
        return jsonify(ok=False, error="expected {lines: [string, ...]}"), 400
    if len(lines) > MAX_LINES:
        return jsonify(ok=False, error=f"too many lines (max {MAX_LINES})"), 413

    with write_lock:
        with LOG_FILE.open("a", encoding="utf-8") as handle:
            for line in lines:
                handle.write(line.rstrip("\n") + "\n")

    print(f"[log] +{len(lines)} line(s) -> {LOG_FILE}", flush=True)
    return jsonify(ok=True, lines=len(lines))


if __name__ == "__main__":
    LOG_FILE.touch(exist_ok=True)
    print(f"[log] writing to {LOG_FILE}", flush=True)
    print("[log] listening on http://127.0.0.1:5000", flush=True)
    app.run(host="127.0.0.1", port=5000, debug=False, threaded=True)
