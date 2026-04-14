import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.database import get_db
from app.models.filing_session import FilingSession
from app.models.tax_return import TaxReturn
from app.schemas.filing import FilingStartRequest, FilingSessionResponse
from app.services import filing_agent
from app.services.llm_factory import get_llm

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/filing", tags=["filing"])


@router.post("/start")
async def start_filing(req: FilingStartRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TaxReturn).order_by(TaxReturn.id.desc()))
    tr = result.scalars().first()
    if tr is None:
        raise HTTPException(status_code=404, detail="No tax return found. Complete tax calculation first.")

    tax_data: dict = json.loads(tr.data_json) if tr.data_json else {}
    calc_results: dict = json.loads(tr.calc_results_json) if tr.calc_results_json else {}
    tax_data["filing_status"] = tr.filing_status
    tax_data["tax_year"] = tr.tax_year
    tax_data["calc_results"] = calc_results

    try:
        llm = await get_llm(db)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    session = FilingSession(
        tax_return_id=tr.id,
        status="running",
        current_step="Starting browser agent…",
        steps_log=json.dumps([]),
        started_at=datetime.now(timezone.utc),
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    await filing_agent.start_session(
        session_id=session.id,
        tax_data=tax_data,
        olt_username=req.olt_username,
        olt_password=req.olt_password,
        llm=llm,
    )

    return {"session_id": str(session.id)}


@router.get("/sessions/{session_id}", response_model=FilingSessionResponse)
async def get_session(session_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(FilingSession).where(FilingSession.id == session_id))
    session = result.scalars().first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.post("/sessions/{session_id}/stop")
async def stop_session(session_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(FilingSession).where(FilingSession.id == session_id))
    session = result.scalars().first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    await filing_agent.stop_session(session_id)
    session.status = "stopped"
    session.completed_at = datetime.now(timezone.utc)
    await db.commit()
    return {"ok": True}


@router.get("/sessions/{session_id}/stream")
async def stream_session(session_id: int):
    async def event_generator():
        queue = filing_agent.get_event_queue(session_id)
        if queue is None:
            yield {"data": json.dumps({"type": "error", "error": "Session not active"})}
            return

        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=30.0)
                yield {"data": json.dumps(event)}
                if event.get("type") in ("done", "error"):
                    break
            except asyncio.TimeoutError:
                yield {"data": json.dumps({"type": "ping"})}

    return EventSourceResponse(event_generator())


@router.get("/sessions/{session_id}/screenshot")
async def get_screenshot(session_id: int):
    path = filing_agent.get_screenshot_path(session_id)
    if path is None or not Path(path).exists():
        raise HTTPException(status_code=404, detail="No screenshot available yet")
    return FileResponse(path, media_type="image/png")
