#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Starting US Tax Return Agent (dev mode)"

# Backend
echo "==> Starting FastAPI backend..."
cd "$ROOT/backend"
if [ ! -d ".venv" ]; then
  echo "    No venv found — run scripts/setup.sh first"
  exit 1
fi
source .venv/bin/activate
mkdir -p uploads data
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
echo "    Backend PID: $BACKEND_PID"

# Frontend
echo "==> Starting Next.js frontend..."
cd "$ROOT/frontend"
npm run dev &
FRONTEND_PID=$!
echo "    Frontend PID: $FRONTEND_PID"

echo ""
echo "  Backend:  http://localhost:8000"
echo "  Frontend: http://localhost:3000"
echo "  API Docs: http://localhost:8000/docs"
echo ""
echo "  Press Ctrl+C to stop all services"

trap "echo '==> Stopping...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
