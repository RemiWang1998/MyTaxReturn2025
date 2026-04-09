# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A locally-hosted fullstack tax return agent. Privacy-first: all data stays on the user's machine. Not enterprise SaaS.

- Users upload tax forms (PDF/images/ZIP) → LLM vision extracts data
- `irs-taxpayer-mcp` (Node.js, 39 tools) handles tax calculations via MCP protocol
- `browser-use` (Python + Playwright) automates filing on olt.com
- Users supply their own LLM API key (stored Fernet-encrypted in SQLite)

## Development Commands

### First-time setup
```bash
bash scripts/setup.sh
# Creates backend/.venv, installs Python deps, installs Playwright, runs npm install
cp .env.example .env  # already done by setup.sh if .env missing
```

### Run dev servers (both backend + frontend)
```bash
bash scripts/dev.sh
# Backend: http://localhost:8000  (FastAPI + uvicorn --reload)
# Frontend: http://localhost:3000 (Next.js)
# API docs: http://localhost:8000/docs
```

### Backend only
```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend only
```bash
cd frontend
npm run dev
```

### Backend tests
```bash
cd backend
source .venv/bin/activate
pytest                          # all tests
pytest tests/test_api_keys.py  # single file
pytest -k "test_name"          # single test
```

### Install a new Python dependency
```bash
cd backend
source .venv/bin/activate
uv pip install <package>
# Also add to pyproject.toml dependencies
```

## Architecture

### Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | Next.js (TypeScript, Tailwind, shadcn/ui) |
| Backend | FastAPI (Python 3.11+, async) |
| Database | SQLite via SQLAlchemy async (aiosqlite) |
| Encryption | Fernet (`cryptography` lib) for API keys |
| Document parsing | LLM Vision (Claude/OpenAI) via LangChain |
| PDF→images | PyMuPDF |
| Tax calculations | `irs-taxpayer-mcp` Node.js subprocess (stdio MCP) |
| Browser automation | `browser-use` + Playwright (headless=False) |
| Agent streaming | SSE (sse-starlette) |

### Backend Structure (`backend/app/`)
- `main.py` — FastAPI app, CORS, lifespan
- `config.py` — pydantic-settings from `.env`
- `database.py` — async SQLAlchemy engine + session
- `security.py` — Fernet encrypt/decrypt; key auto-generated at `data/.encryption_key` on first run
- `models/` — SQLAlchemy ORM (api_key, document, extracted_data, tax_return, filing_session)
- `schemas/` — Pydantic request/response models (including typed form schemas: W2Data, Form1099Data, etc.)
- `routers/` — one file per domain (api_keys, documents, extraction, tax_return, filing)
- `services/` — business logic: `llm_factory.py`, `document_parser.py`, `tax_aggregator.py`, `mcp_client.py`, `filing_agent.py`
- `prompts/` — LLM prompt templates per form type

### Frontend Structure (`frontend/src/`)
- `app/` — Next.js App Router pages: dashboard, settings, documents, review, calculate, filing
- `components/` — organized by page domain + `ui/` (shadcn primitives)
- `lib/api.ts` — typed API client (single source of truth for backend calls)
- `hooks/` — React hooks per domain

### Key Data Flows

**Document extraction:** Upload → save file + DB row → PDF pages to images via PyMuPDF → LLM vision with form-specific prompt → structured JSON with per-field confidence scores → stored in `extracted_data` table. Fields with confidence < 0.8 are highlighted in the review UI.

**Tax calculations (MCP):** Backend spawns `npx -y irs-taxpayer-mcp` as a stdio subprocess; `services/mcp_client.py` is the MCP client. Exposed via `/api/return/calculate`, `/api/return/compare-status`, `/api/return/check-credits`.

**Browser agent filing:** `POST /api/filing/start` → asyncio Task → `browser-use` Agent with Playwright (visible browser) → navigates olt.com → **agent stops before final submit** (user must click submit manually) → progress pushed via SSE + screenshots at each step. OLT credentials are never stored — React state only, sent per-session.

### Database Schema (SQLite, JSON columns for flexible tax data)
```
api_keys        (id, provider UNIQUE, encrypted_key, model_name, created_at, updated_at)
documents       (id, filename, file_path, file_type, doc_type, status, error_msg, created_at)
extracted_data  (id, document_id FK, form_type, data_json, confidence, field_confidences, user_verified, created_at, updated_at)
tax_returns     (id, tax_year, filing_status, data_json, calc_results_json, status, created_at, updated_at)
filing_sessions (id, tax_return_id FK, status, current_step, steps_log, error_msg, started_at, completed_at)
```

### Environment Variables (`.env`)
```
BACKEND_PORT=8000
FRONTEND_PORT=3000
ENCRYPTION_KEY_PATH=data/.encryption_key
DATABASE_URL=sqlite+aiosqlite:///data/tax_return.db
CORS_ORIGINS=http://localhost:3000
```
Frontend accesses backend via `NEXT_PUBLIC_API_URL` (set in docker-compose or locally).

## Important Design Decisions

- **API keys never returned to frontend** after storage — GET endpoints return provider names only; keys are decrypted at runtime in `llm_factory.py`
- **ZIP bomb protection** required when extracting uploaded ZIPs — check uncompressed size before extraction
- **SSE over WebSockets** for agent streaming — unidirectional, native `EventSource` on frontend
- **JSON columns in SQLite** for tax form data — form types vary too much for rigid schema
- **i18n via `next-intl`** — UI supports Simplified Chinese (zh-CN); LLM prompts must handle Chinese-language tax documents
- **Docker note:** browser agent requires native backend (Playwright needs display); Docker setup is for other services only

## Next.js Version Warning

See `frontend/CLAUDE.md` / `frontend/AGENTS.md`: this Next.js version may have breaking API changes from training data. Before writing frontend code, check `frontend/node_modules/next/dist/docs/` for the actual API and heed deprecation notices.
