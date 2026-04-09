#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Setting up US Tax Return Agent"

# --- Backend ---
echo "==> Backend: creating Python venv and installing deps"
cd "$ROOT/backend"
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip uv
uv pip install -e ".[dev]"

echo "==> Backend: installing Playwright browsers"
playwright install chromium --with-deps

mkdir -p uploads data

# --- Frontend ---
echo "==> Frontend: installing Node deps"
cd "$ROOT/frontend"
npm install

# --- Copy .env if missing ---
cd "$ROOT"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "==> Created .env from .env.example — edit it as needed"
fi

echo ""
echo "Setup complete!"
echo "  Run:  bash scripts/dev.sh"
