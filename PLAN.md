# US Tax Return Agent - Implementation Plan

## Context

Build a locally-hosted fullstack tax return agent that:
1. Lets users upload tax forms (PDF, images, ZIP) and extracts data via LLM vision
2. Uses the `irs-taxpayer-mcp` server (39 tools) for tax calculations, credits, deductions, and filing status comparison
3. Provides a browser agent (via `browser-use`) to automate filing on olt.com
4. Requires user to provide their own LLM API key (stored encrypted locally)

This is a personal local tool, not enterprise SaaS. Privacy-first: all data stays on the user's machine.

---

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | **Next.js** (TypeScript, Tailwind, shadcn/ui) | Modern React, good file upload UX |
| Backend | **FastAPI** (Python) | Best ecosystem for doc processing + browser-use |
| Browser Agent | **browser-use** (Python, Playwright) | LLM-driven, 50k+ stars, supports multiple providers |
| Tax Calculations | **irs-taxpayer-mcp** (Node.js MCP server) | 39 tools, 100% local, no network calls |
| Document Parsing | LLM Vision API (Claude/OpenAI) | Highest accuracy for structured form extraction |
| Database | **SQLite** (SQLAlchemy) | Simple, no setup, local-only |
| Encryption | **Fernet** (cryptography lib) | Symmetric encryption for stored API keys |

---

## Directory Structure

```
USTaxReturn2025/
├── docker-compose.yml
├── .gitignore
├── .env.example
│
├── backend/
│   ├── pyproject.toml
│   ├── Dockerfile
│   ├── app/
│   │   ├── main.py                     # FastAPI app, CORS, lifespan
│   │   ├── config.py                   # pydantic-settings
│   │   ├── database.py                 # SQLite + SQLAlchemy
│   │   ├── security.py                 # Fernet encrypt/decrypt
│   │   │
│   │   ├── models/                     # SQLAlchemy ORM
│   │   │   ├── api_key.py
│   │   │   ├── document.py
│   │   │   ├── extracted_data.py
│   │   │   ├── tax_return.py
│   │   │   └── filing_session.py
│   │   │
│   │   ├── schemas/                    # Pydantic request/response
│   │   │   ├── api_key.py
│   │   │   ├── document.py
│   │   │   ├── tax_forms.py            # W2Data, Form1099Data, etc.
│   │   │   ├── tax_return.py
│   │   │   └── filing.py
│   │   │
│   │   ├── routers/
│   │   │   ├── api_keys.py             # CRUD for LLM API keys
│   │   │   ├── documents.py            # Upload, list, delete
│   │   │   ├── extraction.py           # Trigger/review extraction
│   │   │   ├── tax_return.py           # Aggregated return + MCP calcs
│   │   │   └── filing.py              # Browser agent control
│   │   │
│   │   ├── services/
│   │   │   ├── llm_factory.py          # Create LLM from stored keys
│   │   │   ├── document_parser.py      # LLM vision doc extraction
│   │   │   ├── tax_aggregator.py       # Combine docs into return
│   │   │   ├── mcp_client.py           # MCP client for irs-taxpayer-mcp
│   │   │   └── filing_agent.py         # browser-use orchestration
│   │   │
│   │   └── prompts/
│   │       ├── w2_extraction.py
│   │       ├── form1099_extraction.py
│   │       └── filing_instructions.py
│   │
│   ├── uploads/                        # Uploaded files (gitignored)
│   └── data/                           # SQLite DB + encryption key (gitignored)
│
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   └── src/
│       ├── app/
│       │   ├── layout.tsx              # Sidebar nav layout
│       │   ├── page.tsx                # Dashboard
│       │   ├── settings/page.tsx       # API key management
│       │   ├── documents/page.tsx      # Upload & manage docs
│       │   ├── review/page.tsx         # Review extracted data
│       │   ├── calculate/page.tsx      # Tax calculations (MCP)
│       │   └── filing/page.tsx         # Browser agent control
│       │
│       ├── components/
│       │   ├── ui/                     # shadcn/ui primitives
│       │   ├── layout/                 # sidebar, header
│       │   ├── settings/              # api-key-form
│       │   ├── documents/             # upload-zone, document-list
│       │   ├── review/                # tax-data-editor, w2-review, 1099-review
│       │   ├── calculate/             # tax-summary, filing-status-compare, credits-check
│       │   └── filing/                # credentials-form, agent-controls, agent-log, screenshot-viewer
│       │
│       ├── lib/
│       │   └── api.ts                 # Typed API client
│       └── hooks/                     # React hooks per domain
│
└── scripts/
    ├── setup.sh                       # One-command setup
    └── dev.sh                         # Start all services
```

---

## API Endpoints

### API Keys — `/api/keys`
- `GET /api/keys` — List providers (names only, never keys)
- `POST /api/keys` — Store encrypted key `{provider, api_key, model_name}`
- `DELETE /api/keys/{provider}` — Remove key
- `POST /api/keys/test` — Validate key with a small LLM call

### Documents — `/api/documents`
- `POST /api/documents/upload` — Multipart upload (PDF, PNG, JPG, ZIP)
- `GET /api/documents` — List all with status
- `GET /api/documents/{id}` — Single doc + extracted data
- `DELETE /api/documents/{id}` — Delete doc + data
- `GET /api/documents/{id}/preview` — Serve file for preview

### Extraction — `/api/extraction`
- `POST /api/extraction/{doc_id}/run` — Trigger LLM vision extraction
- `GET /api/extraction/{doc_id}/result` — Get result with confidence scores
- `PUT /api/extraction/{doc_id}/result` — User edits/corrects data

### Tax Return — `/api/return`
- `GET /api/return` — Aggregated data from all docs
- `GET /api/return/summary` — Total income, deductions, estimated tax
- `PUT /api/return` — Override/edit aggregated data
- `POST /api/return/calculate` — Run MCP tax calculations (federal + state)
- `POST /api/return/compare-status` — Compare filing statuses via MCP
- `POST /api/return/check-credits` — Check credit eligibility via MCP

### Filing — `/api/filing`
- `POST /api/filing/start` — Start browser agent `{olt_username, olt_password}`
- `GET /api/filing/sessions/{id}` — Session status
- `GET /api/filing/sessions/{id}/stream` — SSE real-time step updates
- `POST /api/filing/sessions/{id}/stop` — Stop agent
- `GET /api/filing/sessions/{id}/screenshot` — Latest browser screenshot

---

## Database Schema (SQLite)

```sql
api_keys (id, provider UNIQUE, encrypted_key, model_name, created_at, updated_at)
documents (id, filename, file_path, file_type, doc_type, status, error_msg, created_at)
extracted_data (id, document_id FK, form_type, data_json, confidence, field_confidences, user_verified, created_at, updated_at)
tax_returns (id, tax_year, filing_status, data_json, calc_results_json, status, created_at, updated_at)
filing_sessions (id, tax_return_id FK, status, current_step, steps_log, error_msg, started_at, completed_at)
```

---

## Key Workflows

### 1. Document Upload & Extraction
1. User drags files onto upload zone (validates type + size client-side)
2. Backend saves file, creates `documents` row (status: `uploaded`)
3. For ZIP: extract contents, create one row per contained file (ZIP bomb protection: check uncompressed size)
4. Auto-trigger extraction: convert PDF pages to images via `pymupdf`, send to LLM vision with form-specific prompt
5. LLM returns structured JSON (Pydantic-validated) with per-field confidence scores
6. Store in `extracted_data` table; fields with confidence < 0.8 highlighted in review UI

### 2. Tax Calculation (MCP Integration)
The `irs-taxpayer-mcp` server runs as a sidecar Node.js process. The backend communicates with it via MCP protocol through `services/mcp_client.py`.

**Integration approach:**
- Start MCP server as subprocess: `npx -y irs-taxpayer-mcp` (stdio transport)
- Use `mcp` Python SDK to connect as client
- Expose key MCP tools through `/api/return/calculate`, `/api/return/compare-status`, `/api/return/check-credits`

**Calculation flow:**
1. After user reviews extracted data, they click "Calculate Tax"
2. Backend calls MCP `calculate_federal_tax` with aggregated income/deductions
3. Backend calls MCP `estimate_state_tax` for state taxes
4. Backend calls MCP `check_credit_eligibility` to find applicable credits
5. Results shown on the Calculate page: breakdown by bracket, effective rate, credits, refund estimate
6. User can run `compare_filing_statuses` to see which status is optimal
7. All calculation results stored in `tax_returns.calc_results_json`

### 3. Browser Agent Filing (olt.com)
1. User enters OLT credentials (held in React state only, never stored)
2. `POST /api/filing/start` creates session, spawns `asyncio.Task`
3. `filing_agent.py`:
   - Creates `browser-use` Agent with `headless=False` (visible browser window)
   - Task prompt built dynamically from tax return data (income, deductions, credits)
   - Agent navigates olt.com: login → personal info → income → deductions → credits → review
   - **Critical safety: prompt instructs agent to STOP before final submit**
   - Step callbacks write progress to DB + push SSE events
   - Screenshots captured at each step via Playwright
4. Frontend streams progress via SSE: step log + screenshot viewer
5. User manually reviews the OLT summary screen and clicks submit themselves

### 4. API Key Management
- User enters key in Settings page, selects provider (Anthropic/OpenAI)
- Backend encrypts with Fernet before SQLite storage
- Encryption key auto-generated on first run, stored at `data/.encryption_key`
- Keys never returned to frontend after storage (GET returns provider names only)
- `llm_factory.py` decrypts at runtime to create LLM instances

---

## Implementation Order

### Phase 1: Scaffolding
- `git init`, `.gitignore`, `.env.example`
- Backend: `pyproject.toml` with deps (fastapi, uvicorn, sqlalchemy, cryptography, pymupdf, browser-use, langchain-anthropic, langchain-openai, python-multipart, sse-starlette, mcp)
- Frontend: `npx create-next-app@latest` (TS, Tailwind, App Router) + shadcn/ui init
- `docker-compose.yml`, Dockerfiles, `scripts/dev.sh`

### Phase 2: Backend Core
- `config.py`, `database.py`, `security.py`
- All SQLAlchemy models + initial schema creation
- `main.py` with CORS, lifespan, router mounting
- `routers/api_keys.py` — full CRUD
- `services/llm_factory.py` — create LLM from stored keys

### Phase 3: Document Upload & Parsing
- `routers/documents.py` — upload with validation, ZIP handling
- `services/document_parser.py` — PDF→images, LLM vision extraction
- Prompt templates for W-2, 1099 family
- `routers/extraction.py` — trigger/get/edit extraction results

### Phase 4: Tax Aggregation & MCP Integration
- `services/tax_aggregator.py` — merge all extracted data
- `services/mcp_client.py` — connect to irs-taxpayer-mcp subprocess
- `routers/tax_return.py` — aggregated data + MCP calculation endpoints

### Phase 5: Frontend
- Layout (sidebar nav), API client (`lib/api.ts`)
- Settings page (API key form)
- Documents page (upload zone, document list)
- Review page (editable extracted data, confidence highlighting)
- Calculate page (tax breakdown, filing status comparison, credits)
- Dashboard (status overview, step-by-step guide)

### Phase 6: Browser Agent
- `services/filing_agent.py` — browser-use Agent with callbacks + SSE
- `routers/filing.py` — start/stop/stream/screenshot endpoints
- Filing page frontend — credentials form, agent controls, live log, screenshot viewer

### Phase 7: Polish
- Error handling, loading states
- `scripts/setup.sh` (installs Python deps, Node deps, Playwright browsers)
- Docker setup (note: for browser agent, native backend recommended over Docker)

---

## Key Design Decisions

1. **SSE over WebSockets** for agent streaming — simpler, unidirectional, native EventSource
2. **JSON columns in SQLite** for tax data — form types vary too much for rigid schema
3. **MCP subprocess** for tax calculations — irs-taxpayer-mcp runs as stdio child process, backend is MCP client
4. **LLM Vision over OCR** for parsing — understands layout + content in one call, ~$0.01-0.05/doc
5. **OLT credentials never stored** — React state only, sent per-session, discarded after
6. **Agent stops before submit** — user must manually click final submit on olt.com
7. **Chinese language support** — UI and all user-facing text support Simplified Chinese (zh-CN); LLM prompts handle Chinese-language tax documents; i18n via `next-intl` in the frontend

---

## Verification Plan

1. **API keys**: Save a key → test validates it → list shows provider
2. **Upload**: Upload a W-2 PDF → extraction runs → review shows fields with confidence
3. **MCP calculations**: With extracted data, hit calculate → see bracket breakdown, refund estimate
4. **Filing agent**: Start agent with OLT account → watch SSE log stream steps → verify it stops before submit
5. **E2E**: Upload docs → extract → review → calculate → file on olt.com
