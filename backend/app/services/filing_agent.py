import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.filing_session import FilingSession

logger = logging.getLogger(__name__)

# In-memory state per session (cleared after session ends)
_queues: dict[int, asyncio.Queue] = {}
_agents: dict[int, Any] = {}
_tasks: dict[int, asyncio.Task] = {}
_screenshots: dict[int, str] = {}

SCREENSHOT_DIR = Path("data/screenshots")


def _build_task_prompt(tax_data: dict, olt_username: str, olt_password: str) -> str:
    income = tax_data.get("total_income", 0)
    wages = tax_data.get("wages", 0)
    filing_status = tax_data.get("filing_status", "single")
    tax_year = tax_data.get("tax_year", 2024)
    calc = tax_data.get("calc_results", {})
    federal_tax = calc.get("federal", {}).get("federal_tax", 0) if calc else 0
    refund = calc.get("refund", 0) if calc else 0

    income_lines = []
    for key in ("wages", "interest_income", "ordinary_dividends", "qualified_dividends",
                "nonemployee_compensation", "capital_gains", "other_income"):
        val = tax_data.get(key, 0)
        if val:
            income_lines.append(f"  - {key.replace('_', ' ').title()}: ${val:,.2f}")
    income_detail = "\n".join(income_lines) or "  (no detail available)"

    return f"""You are a tax filing assistant helping file a US tax return on OLT.com.

CREDENTIALS:
- Username/Email: {olt_username}
- Password: {olt_password}

TAX RETURN SUMMARY (Tax Year {tax_year}):
- Filing Status: {filing_status}
- Total Income: ${income:,.2f}
- Federal Tax Owed: ${federal_tax:,.2f}
- Estimated Refund: ${refund:,.2f}

INCOME BREAKDOWN:
{income_detail}

FULL TAX DATA (use for detailed field entry):
{json.dumps({k: v for k, v in tax_data.items() if k != "calc_results"}, indent=2)}

INSTRUCTIONS:
1. Navigate to https://www.olt.com
2. Log in with the credentials above
3. Start a new tax return for tax year {tax_year} (or continue an existing one)
4. Fill in each section accurately using the tax data provided:
   - Personal information (name, SSN, address)
   - Filing status: {filing_status}
   - Income from all sources as listed above
   - Deductions (use standard deduction unless itemized data is available)
   - Credits if applicable
5. Navigate through all sections until you reach the final REVIEW or SUMMARY page

CRITICAL SAFETY RULE: STOP at the final review/confirmation/submit page.
Do NOT click "File Now", "Submit", "E-File", or any final submission button.
The user must manually review and submit the return themselves.
Once you reach the summary/review page, report "READY FOR REVIEW - please submit manually" and stop.
"""


async def _update_db_step(session_id: int, step_desc: str) -> None:
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(FilingSession).where(FilingSession.id == session_id))
            s = result.scalars().first()
            if s:
                s.current_step = step_desc
                steps = json.loads(s.steps_log or "[]")
                steps.append(step_desc)
                s.steps_log = json.dumps(steps)
                await db.commit()
    except Exception as exc:
        logger.warning("DB step update failed: %s", exc)


async def _update_db_status(session_id: int, status: str, error_msg: str | None = None) -> None:
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(FilingSession).where(FilingSession.id == session_id))
            s = result.scalars().first()
            if s:
                s.status = status
                s.completed_at = datetime.now(timezone.utc)
                if error_msg is not None:
                    s.error_msg = error_msg
                await db.commit()
    except Exception as exc:
        logger.warning("DB status update failed: %s", exc)


async def _run_agent(
    session_id: int, tax_data: dict, olt_username: str, olt_password: str, llm: Any
) -> None:
    from browser_use import Agent
    from browser_use.browser.profile import BrowserProfile
    from browser_use.browser.session import BrowserSession

    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
    queue = _queues[session_id]

    async def on_step_end(agent: Agent) -> None:
        step_n = agent.state.n_steps

        # Build step description from model output
        step_desc = f"Step {step_n}"
        lmo = agent.state.last_model_output
        if lmo:
            if getattr(lmo, "next_goal", None):
                step_desc = f"Step {step_n}: {lmo.next_goal[:200]}"
            elif getattr(lmo, "evaluation_previous_goal", None):
                step_desc = f"Step {step_n}: {lmo.evaluation_previous_goal[:200]}"
        if step_desc == f"Step {step_n}" and agent.state.last_result:
            for r in agent.state.last_result:
                content = getattr(r, "extracted_content", None)
                if content:
                    step_desc = f"Step {step_n}: {content[:200]}"
                    break

        # Capture screenshot
        try:
            path = str(SCREENSHOT_DIR / f"session_{session_id}_step_{step_n:03d}.png")
            await agent.browser_session.take_screenshot(path=path)
            _screenshots[session_id] = path
        except Exception as exc:
            logger.warning("Screenshot failed at step %d: %s", step_n, exc)

        await _update_db_step(session_id, step_desc)
        await queue.put({"type": "step", "step": step_desc, "n": step_n})

    task_prompt = _build_task_prompt(tax_data, olt_username, olt_password)
    profile = BrowserProfile(headless=False)
    browser_session = BrowserSession(browser_profile=profile)

    agent = Agent(
        task=task_prompt,
        llm=llm,
        browser=browser_session,
        enable_signal_handler=False,
    )
    _agents[session_id] = agent

    try:
        await agent.run(max_steps=60, on_step_end=on_step_end)
        if getattr(agent.state, "stopped", False):
            await _update_db_status(session_id, "stopped")
            await queue.put({"type": "done", "status": "stopped"})
        else:
            await _update_db_status(session_id, "completed")
            await queue.put({"type": "done", "status": "completed"})
    except asyncio.CancelledError:
        await _update_db_status(session_id, "stopped")
        await queue.put({"type": "done", "status": "stopped"})
        logger.info("Filing session %d cancelled", session_id)
    except Exception as exc:
        logger.exception("Filing session %d error: %s", session_id, exc)
        await _update_db_status(session_id, "error", error_msg=str(exc))
        await queue.put({"type": "error", "error": str(exc)})
    finally:
        _agents.pop(session_id, None)
        _tasks.pop(session_id, None)
        try:
            await browser_session.close()
        except Exception:
            pass


async def start_session(
    session_id: int, tax_data: dict, olt_username: str, olt_password: str, llm: Any
) -> None:
    queue: asyncio.Queue = asyncio.Queue()
    _queues[session_id] = queue

    task = asyncio.create_task(
        _run_agent(session_id, tax_data, olt_username, olt_password, llm),
        name=f"filing_agent_{session_id}",
    )
    _tasks[session_id] = task


async def stop_session(session_id: int) -> None:
    agent = _agents.get(session_id)
    if agent:
        try:
            agent.stop()
        except Exception:
            pass
    task = _tasks.get(session_id)
    if task and not task.done():
        task.cancel()


def get_screenshot_path(session_id: int) -> str | None:
    return _screenshots.get(session_id)


def get_event_queue(session_id: int) -> asyncio.Queue | None:
    return _queues.get(session_id)
