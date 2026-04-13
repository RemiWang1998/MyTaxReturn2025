# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Follow `PLAN.md` for implementation order, architectural decisions, and workflow details.

## What This App Does

A locally-hosted, privacy-first tax return agent that:
1. Accepts uploaded tax documents (PDF, PNG, JPG, ZIP)
2. Uses LLM vision to extract structured data (W-2, 1099-NEC/INT/DIV/MISC/B/R/S/DA/G, consolidated 1099s)
3. Aggregates extracted data into a unified tax return
4. Runs federal + state tax calculations via the `irs-taxpayer-mcp` MCP subprocess (39 tools)
5. (Phase 6, incomplete) Automates filing on olt.com using a browser agent

All data stays on the user's machine. API keys are Fernet-encrypted before SQLite storage.

## Development Commands

### Quick Start
```bash
bash scripts/setup.sh   # one-time: Python venv, npm install, Playwright install
bash scripts/dev.sh     # start backend (port 8000) + frontend (port 3000) concurrently
```

### Backend (from `backend/`)
```bash
source .venv/bin/activate          # activate venv (created by setup.sh in project root)
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
pytest                             # run all tests
playwright install chromium --with-deps  # required before first use
```

### Frontend (from `frontend/`)
```bash
npm run dev    # dev server on port 3000
npm run build  # production build
npm start      # serve production build
```

### Docker
```bash
docker-compose up   # builds and runs both services
```

## Architecture

```
frontend/ (Next.js 16, React 19, TypeScript, Tailwind, shadcn/ui, next-intl)
    │  HTTP via typed API client (src/lib/api.ts)
    ▼
backend/ (FastAPI, Python 3.11+, async SQLAlchemy, SQLite)
    ├── routers/     api_keys | documents | extraction | tax_return | filing
    ├── services/    llm_factory | document_parser | tax_aggregator | mcp_client
    └── models/      5 ORM tables (api_keys, documents, extracted_data, tax_returns, filing_sessions)
          │
          ├── LangChain (Anthropic, OpenAI, Gemini) — vision extraction
          ├── PyMuPDF — PDF→PNG conversion (2× zoom)
          └── irs-taxpayer-mcp — spawned as stdio subprocess for tax calculations
```

### Key Flows

**Document Extraction:** Upload → `document_parser.py` converts PDF pages to PNG via PyMuPDF → LLM vision (configured provider) identifies form type and extracts fields → confidence scores stored per-field in `extracted_data` table.

**Tax Calculation:** `tax_aggregator.py` merges all extracted forms → `mcp_client.py` spawns `irs-taxpayer-mcp` as a subprocess (stdio transport) → calls tools for federal/state calculations, filing status comparison, credit checks.

**Browser Filing (Phase 6 — incomplete):** `services/filing_agent.py` skeleton + `routers/filing.py` stub exist but are not implemented. SSE streaming endpoint ready for real-time agent progress.

## Project Configuration

- `.env` (copy from `.env.example`): sets ports, `DATABASE_URL`, `ENCRYPTION_KEY_PATH`, `CORS_ORIGINS`
- Encryption key auto-generated at `data/.encryption_key` on first run
- i18n: 3 locales (`en`, `zh-CN`, `zh-TW`) via `frontend/src/messages/*.json`
- Prompts for LLM extraction live in `backend/app/prompts/` — separate from service logic

## Key Design Decisions

- **JSON columns in SQLite** for tax data (flexible schema handles varying form field sets)
- **MCP subprocess over library** — `irs-taxpayer-mcp` runs as a child process via stdio
- **SSE over WebSockets** for streaming filing agent progress
- **OLT credentials never stored** — kept in React state only, discarded after session
- **Agent stops before submit** — user manually confirms before final filing action
- **LLM vision over OCR** — handles layout understanding + Chinese-language documents

## Implementation Status

- Phases 1–5: Complete (scaffolding, backend core, document parsing, aggregation/MCP, frontend)
- Phase 6 (browser agent / OLT filing): Not started — skeleton files only
- Phase 7 (polish): Partially done (error handling, loading states, Docker, scripts)

See `PLAN.md` for the full implementation roadmap and API endpoint specifications.
