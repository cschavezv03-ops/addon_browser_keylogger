#!/usr/bin/env bash
# Starts the local log server using the project's virtualenv.
set -euo pipefail
cd "$(dirname "$0")"

PYTHON="${PYTHON:-.venv/bin/python}"

if [ ! -x "$PYTHON" ]; then
  echo "No se encontró $PYTHON; creando un virtualenv..." >&2
  python3 -m venv .venv
  PYTHON=.venv/bin/python
fi

if ! "$PYTHON" -c "import flask" >/dev/null 2>&1; then
  echo "Flask no está instalado; instalando requirements.txt..." >&2
  "$PYTHON" -m pip install -r requirements.txt
fi

exec "$PYTHON" browser_extension/server.py
